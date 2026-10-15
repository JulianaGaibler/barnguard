import { Node2D } from '../scene/Node2D'
import type { BoxConstraints, Size } from '../layout/constraints'
import { isLayoutHost, type Measurable } from '../layout/LayoutNode'
import type {
  LottieAnimation,
  LottieDiagnostic,
  LottieMarker,
} from '../lottie/model/types'
import { LottiePlayer, type PlaybackMode } from '../lottie/player/LottiePlayer'
import {
  computeLayout,
  type LayoutAlign,
  type LayoutFit,
  type LayoutResult,
} from '../lottie/player/layout'
import { LottieRenderer } from '../lottie/render/LottieRenderer'
import { LottieScene } from '../lottie/render/LottieScene'
import {
  applyTheme,
  resetSlots,
  setSlotValue,
  type LottieSlotValue,
  type LottieTheme,
} from '../lottie/dotlottie/theme'
import type { Node } from '../scene/Node'

/** What a `LottieNode` does while it is not being drawn. */
export type LottieOffscreenMode = 'advance' | 'freeze'

/** Options for a {@link LottieNode}. */
export interface LottieNodeOptions {
  /** The parsed animation to play. See `parseLottie`. */
  animation: LottieAnimation
  /** Node id. */
  id?: string
  /**
   * Width of the box the animation is fitted into. Default: the composition
   * width.
   */
  width?: number
  /** Height of the box. Default: the composition height. */
  height?: number
  /** How the composition fits the box. Default `'contain'`. */
  fit?: LayoutFit
  /** Horizontal alignment inside the box, 0 to 1 or a name. Default `'center'`. */
  alignX?: LayoutAlign
  /** Vertical alignment inside the box. Default `'center'`. */
  alignY?: LayoutAlign
  /** Start playing when the node is created. Default `true`. */
  autoplay?: boolean
  /** Repeat at the end. Default `true`. */
  looping?: boolean
  /** Total playthroughs when looping, `0` for forever. Default `0`. */
  loopCount?: number
  /** Playback speed, above 0. Default `1`. */
  speed?: number
  /** Playback direction. Default `'forward'`. */
  mode?: PlaybackMode
  /** Restrict playback to frames `[start, end]`. */
  segment?: readonly [number, number]
  /** Interpolate between whole frames. Default `true`. */
  useFrameInterpolation?: boolean
  /**
   * How layer opacity applies. `'exact'` (default) composites a layer with
   * several overlapping shapes as one unit, so the shapes do not show through
   * each other, and costs an offscreen surface for those layers. `'fold'`
   * multiplies the opacity into every shape, which is cheaper and differs only
   * where a layer's shapes overlap.
   */
  opacityMode?: 'exact' | 'fold'
  /**
   * Where image layers get their pictures. Given an image's file name, folder
   * and whether the file embeds it as a data URI, return a URL, a `Blob`, or
   * bytes. The default uses an embedded data URI as is, and otherwise joins
   * `baseUrl`, the folder and the file name.
   */
  assetResolver?: (image: {
    path: string
    dir: string
    embedded: boolean
  }) => string | Blob | Uint8Array
  /** Prefix for relative image paths. Default none. */
  baseUrl?: string
  /**
   * Turns what the resolver returned into something drawable. The default
   * fetches a URL and decodes it with `createImageBitmap`.
   */
  imageDecoder?: (
    source: string | Blob | Uint8Array,
  ) => Promise<CanvasImageSource>
  /**
   * What to do while the node is not drawn (culled or hidden). `'advance'`
   * keeps time running. `'freeze'` pauses it, so the animation resumes where it
   * left off. Default `'advance'`.
   */
  offscreen?: LottieOffscreenMode
}

/**
 * A scene node that plays a Lottie animation. Place it like any other node: it
 * has a transform, culls against its box, can sit in a layout container, and
 * draws through the retained model so it batches with the rest of the frame.
 *
 * The composition is fitted into a `width` by `height` box with
 * {@link LottieNodeOptions.fit}. The node's origin is the top-left corner of the
 * box.
 *
 * @remarks
 *   Engine developers: the node holds the animation's layers as child nodes,
 *   built by `LottieScene`. `onUpdate` only advances the player. Evaluation
 *   (sampling properties and rebuilding paths) happens in `draw`, which the
 *   compose walk calls before the layers when the node is not culled, and only
 *   when the playback frame or the layout changed. It then moves the layer
 *   nodes and marks for repaint the ones whose content is animated.
 * @example
 *   const anim = parseLottie(json)
 *   const spinner = new LottieNode({
 *     animation: anim,
 *     width: 96,
 *     height: 96,
 *   })
 *   spinner.transform.x = 200
 *   scene.root.add(spinner)
 *   spinner.player.events.on('loop', ({ count }) => console.log(count))
 */
export class LottieNode extends Node2D implements Measurable {
  /** The playback controller. Use it for events and fine control. */
  readonly player: LottiePlayer
  /** The animation being played. */
  readonly animation: LottieAnimation
  /** Preallocated size for layout. */
  readonly measuredSize: Size = { w: 0, h: 0 }
  /** What to do while the node is not drawn. */
  offscreen: LottieOffscreenMode

  readonly #renderer: LottieRenderer
  readonly #scene: LottieScene
  #width: number
  #height: number
  #fit: LayoutFit
  #alignX: LayoutAlign
  #alignY: LayoutAlign
  #dirty = true
  #frame = 0
  #drewSinceUpdate = true
  #evaluations = 0
  readonly #layout: LayoutResult = { scaleX: 1, scaleY: 1, x: 0, y: 0 }

  constructor(opts: LottieNodeOptions) {
    super(opts.id)
    this.animation = opts.animation
    this.#width = opts.width ?? opts.animation.width
    this.#height = opts.height ?? opts.animation.height
    this.#fit = opts.fit ?? 'contain'
    this.#alignX = opts.alignX ?? 'center'
    this.#alignY = opts.alignY ?? 'center'
    this.offscreen = opts.offscreen ?? 'advance'
    this.player = new LottiePlayer(opts.animation, {
      autoplay: opts.autoplay ?? true,
      looping: opts.looping ?? true,
      loopCount: opts.loopCount,
      speed: opts.speed,
      mode: opts.mode,
      segment: opts.segment ? [opts.segment[0], opts.segment[1]] : undefined,
      useFrameInterpolation: opts.useFrameInterpolation,
    })
    this.#renderer = new LottieRenderer(opts.animation, {
      exactOpacity: (opts.opacityMode ?? 'exact') === 'exact',
    })
    this.#scene = new LottieScene(
      this.#renderer,
      opts.animation.width,
      opts.animation.height,
    )
    // The composition is clipped to its own bounds.
    this.#scene.root.clip = {
      x: 0,
      y: 0,
      width: opts.animation.width,
      height: opts.animation.height,
    }
    this.add(this.#scene.root)
    this.#updateBounds()
    void this.#loadImages(opts)
    this.events.on('destroy', () => {
      this.#renderer.dispose()
    })
  }

  /** Width of the box the composition is fitted into. */
  get width(): number {
    return this.#width
  }
  set width(v: number) {
    if (v === this.#width) return
    this.#width = v
    this.#layoutChanged()
  }

  /** Height of the box the composition is fitted into. */
  get height(): number {
    return this.#height
  }
  set height(v: number) {
    if (v === this.#height) return
    this.#height = v
    this.#layoutChanged()
  }

  /** How the composition fits the box. */
  get fit(): LayoutFit {
    return this.#fit
  }
  set fit(v: LayoutFit) {
    if (v === this.#fit) return
    this.#fit = v
    this.#layoutChanged()
  }

  /** Current playback frame, counted from the animation's first frame. */
  get currentFrame(): number {
    return this.player.currentFrame
  }

  /** Number of frames in the animation. */
  get totalFrames(): number {
    return this.animation.totalFrames
  }

  /** Duration in milliseconds. */
  get durationMs(): number {
    return this.animation.durationMs
  }

  /** The animation's markers. */
  get markers(): readonly LottieMarker[] {
    return this.animation.markers
  }

  /**
   * What the loader and the renderer ignored or approximated for this
   * animation. The renderer's entries use codes starting with `unsupported-`
   * and appear once the features are drawn from the compiled tree.
   */
  get diagnostics(): readonly LottieDiagnostic[] {
    const extra: LottieDiagnostic[] =
      this.#missingImages > 0
        ? [
            {
              code: 'image-missing',
              message: `${this.#missingImages} image(s) failed to load.`,
            },
          ]
        : []
    return [
      ...this.animation.diagnostics,
      ...this.#renderer.diagnostics,
      ...extra,
    ]
  }

  /** Counters for the profiler. */
  get stats(): { evaluations: number } {
    return { evaluations: this.#evaluations }
  }

  /** Start or resume playback. */
  play(): void {
    this.player.play()
  }
  /** Pause at the current frame. */
  pause(): void {
    this.player.pause()
  }
  /** Stop and return to the first frame. */
  stop(): void {
    this.player.stop()
    this.#dirty = true
  }
  /** Jump to `frame`, counted from the first frame. */
  seek(frame: number): void {
    this.player.seek(frame)
    this.#dirty = true
  }
  /** Restrict playback to frames `[start, end]`. */
  setSegment(start: number, end: number): boolean {
    return this.player.setSegment(start, end)
  }
  /** Restrict playback to a named marker, or clear it with `null`. */
  setMarker(name: string | null): boolean {
    const ok = this.player.setMarker(name)
    this.#dirty = true
    return ok
  }

  #missingImages = 0

  async #loadImages(opts: LottieNodeOptions): Promise<void> {
    const decode = opts.imageDecoder ?? defaultImageDecoder
    for (const image of this.#renderer.pendingImages()) {
      try {
        const source = opts.assetResolver
          ? opts.assetResolver(image)
          : image.embedded
            ? image.path
            : `${opts.baseUrl ?? ''}${image.dir}${image.path}`
        this.#renderer.setImage(image.id, await decode(source))
        this.#scene.repaintAll()
      } catch {
        this.#missingImages++
      }
    }
  }

  /**
   * Apply a theme, replacing the values of the slots it names. `null` restores
   * the file's own values. The theme changes the animation object this node
   * holds, so nodes that should look different need their own parse of the
   * animation (`DotLottie.getAnimation` parses afresh on each call).
   */
  setTheme(theme: LottieTheme | null, animationId?: string): void {
    applyTheme(this.animation, theme, animationId)
    this.#slotsChanged()
  }

  /**
   * Give slots new values, by slot id. Values are theme rule values without the
   * `id`. Unknown ids are ignored. Returns how many properties changed.
   *
   * @example
   *   node.setSlots({ 'body-main': { type: 'Color', value: [1, 0.2, 0] } })
   */
  setSlots(values: Record<string, LottieSlotValue>): number {
    let changed = 0
    for (const [id, value] of Object.entries(values)) {
      changed += setSlotValue(this.animation, id, value)
    }
    this.#slotsChanged()
    return changed
  }

  /** Restore every slot to the value the file gives it. */
  resetSlots(): void {
    resetSlots(this.animation)
    this.#slotsChanged()
  }

  #slotsChanged(): void {
    this.#renderer.invalidate()
    this.#scene.repaintAll()
    this.#dirty = true
  }

  // --- layout ----------------------------------------------------------------

  /** Report the box size, clamped to `constraints`. */
  measure(constraints: BoxConstraints): Size {
    this.measuredSize.w = constraints.constrainW(this.#width)
    this.measuredSize.h = constraints.constrainH(this.#height)
    return this.measuredSize
  }

  /** Place the node's box at `(x, y)` with the size the parent assigned. */
  arrange(x: number, y: number, w: number, h: number): void {
    this.transform.x = x
    this.transform.y = y
    this.#width = w
    this.#height = h
    this.#updateBounds()
  }

  #updateBounds(): void {
    this.boundsOverride = {
      x: 0,
      y: 0,
      width: this.#width,
      height: this.#height,
    }
  }

  #layoutChanged(): void {
    this.#updateBounds()
    let n: Node | null = this.parent
    while (n) {
      if (isLayoutHost(n)) {
        n.requestLayout()
        return
      }
      n = n.parent
    }
  }

  // --- update and draw -------------------------------------------------------

  override onUpdate(dt: number): void {
    if (this.offscreen === 'freeze') {
      const drew = this.#drewSinceUpdate
      this.#drewSinceUpdate = false
      if (!drew) return
    }
    const r = this.player.advance(dt * 1000)
    this.#frame = r.frame
    if (r.changed) this.#dirty = true
  }

  /**
   * Called each frame the node is not culled, before its layers draw. It brings
   * the layers up to date when the playback frame or the layout changed, so a
   * node that is culled or hidden costs nothing.
   */
  override draw(): void {
    this.#drewSinceUpdate = true
    if (!this.#dirty) return
    const marks = this.engine?.perfMarks ?? false
    if (marks) performance.mark('lottie-evaluate:start')
    const frame = this.animation.inPoint + this.#frame
    this.#renderer.evaluate(frame)
    if (marks) performance.measure('lottie evaluate', 'lottie-evaluate:start')
    const anim = this.animation
    const l = computeLayout(
      anim.width,
      anim.height,
      this.#width,
      this.#height,
      this.#fit,
      this.#alignX,
      this.#alignY,
      this.#layout,
    )
    const t = this.#scene.root.transform
    t.x = l.x
    t.y = l.y
    t.scaleX = l.scaleX
    t.scaleY = l.scaleY
    this.#scene.apply(frame)
    this.#dirty = false
    this.#evaluations++
  }
}

async function defaultImageDecoder(
  source: string | Blob | Uint8Array,
): Promise<CanvasImageSource> {
  let blob: Blob
  if (typeof source === 'string') {
    const res = await fetch(source)
    if (!res.ok) throw new Error(`image ${source} returned ${res.status}`)
    blob = await res.blob()
  } else if (source instanceof Blob) {
    blob = source
  } else {
    blob = new Blob([source as BlobPart])
  }
  return createImageBitmap(blob)
}
