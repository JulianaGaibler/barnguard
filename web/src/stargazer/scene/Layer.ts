import { Camera } from '../camera/Camera'
import type { CameraView2D } from '../camera/CameraView2D'
import type { Rect } from '../math/Rect'
import type { GfxSurfaceCache, GfxSurfaceEffects } from '../render/gfx/Gfx2D'
import type { PostEffect } from '../render/postfx/PostEffect'
import { Node2D } from './Node2D'

/**
 * How a {@link Layer} places its subtree.
 *
 * - `'world'`: the subtree uses whatever view is in effect where the layer sits,
 *   which is the stage's camera unless an enclosing layer says otherwise.
 * - `'screen'`: one unit is one CSS pixel and the origin is the top left of the
 *   canvas, so the subtree ignores the camera.
 * - `{ frame }`: `frame` is fitted into the canvas at a uniform scale and
 *   centered, the way a camera fits its viewport. The subtree ignores the
 *   camera and keeps its proportions at any canvas shape.
 */
export type LayerSpace = 'world' | 'screen' | { frame: Rect }

/**
 * The region of a layer that its effects run over.
 *
 * - `'content'`: the box around what the layer draws, plus its padding.
 * - `'view'`: the whole canvas, whatever the layer draws.
 * - A `Rect` in the layer's own space, plus its padding.
 */
export type LayerRegion = 'content' | 'view' | Rect

/** Whether a {@link Layer} keeps its rendered result between frames. */
export type LayerCache = 'none' | 'raster'

/** Options for a {@link Layer}. */
export interface LayerOptions {
  id?: string
  /** How the subtree is placed. Default `'world'`. */
  space?: LayerSpace
  /**
   * Post-processing effects to run over the layer's subtree and nothing else,
   * in order. Default none.
   */
  effects?: readonly PostEffect[]
  /** The region the effects run over. Default `'content'`. */
  region?: LayerRegion
  /**
   * `'raster'` keeps the layer's rendered result between frames and draws it
   * again, without drawing the subtree, while nothing the subtree draws has
   * changed. Default `'none'`.
   */
  cache?: LayerCache
  /**
   * CSS pixels added around the region on every side, for an effect that
   * spreads past what was drawn, such as a blur. Default 0.
   */
  padding?: number
  /**
   * The color the region is filled with before the layer draws, as CSS. It
   * takes part in the effects. Default none, which leaves the region
   * transparent.
   */
  clearColor?: string | null /**
   * Keep the layer through a scene wipe, see {@link Node.persistent}. Default
   * false.
   */
  persistent?: boolean
}

/**
 * A node that gives its subtree its own placement. Under a layer whose
 * {@link Layer.space} is `'screen'` or a frame, children are positioned by that
 * view and the stage's camera does not move them, so a HUD stays put while the
 * camera pans and zooms underneath.
 *
 * @remarks
 *   A layer with a space of its own is a root of that space. Its `transform` is
 *   the root transform inside the view, so a screen layer can be offset, scaled
 *   or rotated in CSS pixels. Everything under it has a `transform.world` in
 *   layer space, which keeps `localToWorld`, hit testing and layout working
 *   without change. `alpha` and `visible` still cascade from above, because
 *   they are not spatial.
 *
 *   The nearest enclosing layer with a space other than `'world'` decides where a
 *   node is placed. A layer whose space is `'world'` takes the space of the
 *   layer above it, and the stage's camera when there is none.
 *
 *   Code that needs the view a node is placed by uses {@link viewFor}. Screen
 *   positions of a node and its pointer coordinates should come from there, not
 *   from the stage's camera.
 *
 *   `cache: 'raster'` keeps the rendered result, with its effects applied, and
 *   draws that again for as long as nothing the subtree draws has changed. A
 *   frame that reuses it draws one textured quad and skips the subtree, so a
 *   static layer with a blur costs almost nothing. The layer renders again when
 *   a node under it moves, changes visibility or alpha, repaints, is added or
 *   removed, when an effect's parameters change, or when the canvas, the view
 *   or the region changes. The layer's own `alpha` is applied when the result
 *   is drawn and never forces a render. A node that draws immediately (`draw`
 *   instead of `paint`) makes the layer render every frame. Call `invalidate()`
 *   for a change that none of these see.
 *
 *   `effects` run post-processing over the layer's subtree and nothing else. The
 *   subtree draws into a surface, the effects process it, and the result takes
 *   the layer's place in the tree, so what is drawn before and after the layer
 *   is untouched. The same effect instance can be listed on any number of
 *   layers and on the stage. A layer draws without its effects, and
 *   `effectsApplied` is false, while an effect's pipelines are still compiling,
 *   and for a layer that holds an `InsetViewNode` or sits inside one.
 * @example
 *   // A heads-up display that ignores the camera, laid out for a 1920 by 1080
 *   // design and scaled to fit the canvas.
 *   const hud = new Layer({
 *     space: { frame: { x: 0, y: 0, width: 1920, height: 1080 } },
 *   })
 *   stage.tree.root.add(hud)
 *   hud.add(scoreLabel)
 *
 * @example
 *   // A blurred panel over a crisp scene. The blur spreads 24 pixels past the
 *   // panel's edge.
 *   const frosted = new Layer({
 *     effects: [new DualKawaseBlur({ levels: 3 })],
 *     padding: 24,
 *   })
 *   frosted.add(panel)
 *   stage.tree.root.add(frosted)
 */
export class Layer extends Node2D {
  #space: LayerSpace
  #view: Camera | null = null

  /**
   * The effects run over the subtree, in order. Read every frame, so the list
   * and the effects in it can change at any time.
   */
  effects: readonly PostEffect[]
  /** The region the effects run over. */
  region: LayerRegion
  /** CSS pixels added around the region on every side. */
  padding: number
  /** The color the region is filled with first, or `null` for transparent. */
  clearColor: string | null
  /** Whether the rendered result is kept between frames. */
  cache: LayerCache

  /** @internal What the renderer is handed for the effects. */
  readonly _fx: GfxSurfaceEffects

  constructor(opts: LayerOptions = {}) {
    super(opts.id ?? 'layer')
    this.#space = opts.space ?? 'world'
    this.persistent = opts.persistent ?? false
    this.effects = opts.effects ?? []
    this.region = opts.region ?? 'content'
    this.padding = opts.padding ?? 0
    this.clearColor = opts.clearColor ?? null
    this.cache = opts.cache ?? 'none'
    this._fx = { owner: this, effects: this.effects, dt: 0, applied: true }
    this._cacheState = {
      signature: new Float64Array(0),
      length: 0,
      invalidated: false,
      hit: false,
    }
  }

  /** @internal What the renderer is handed to decide on a kept render. */
  readonly _cacheState: GfxSurfaceCache

  /**
   * Draw the layer again from scratch the next time, even if nothing it tracks
   * has changed. For a change the layer cannot see, such as state a node reads
   * while painting without declaring it.
   */
  invalidate(): void {
    this._cacheState.invalidated = true
  }

  /** @internal Whether the layer draws into a surface: it has effects, or it is cached. */
  _usesSurface(): boolean {
    return this.cache === 'raster' || this._hasEffects()
  }

  /**
   * Whether the last frame drew the subtree with every effect applied. False
   * while an effect's pipelines are still compiling, when the subtree draws as
   * it is, and for a layer that cannot be drawn into a surface. True for a
   * layer with no effects to apply.
   */
  get effectsApplied(): boolean {
    return this._fx.applied
  }

  /**
   * Compile the pipelines of the layer's effects now, so the first frame that
   * draws them is not drawn without. Call it while a stall is hidden, such as a
   * scene load. Does nothing until the layer is in a scene, and is safe to
   * repeat.
   */
  warm(): void {
    const scene = this.scene
    const stage = scene?.engine?.stageForScene(scene)
    if (!stage) return
    this._fx.effects = this.effects
    stage._warmEffects(this._fx)
  }

  /** @internal Whether any enabled effect has a pass to run. */
  _hasEffects(): boolean {
    for (const e of this.effects) {
      if (e.enabled && e.passes.length > 0) return true
    }
    return false
  }

  /** How the subtree is placed. Changing it moves everything under the layer. */
  get space(): LayerSpace {
    return this.#space
  }

  set space(value: LayerSpace) {
    this.#space = value
    // The layer stops or starts composing its world from its parent.
    this.markWorldDirty()
  }

  /**
   * The view the subtree is placed by, or `null` for a `'world'` layer. Its
   * mapping follows the canvas size the last time the layer was drawn or
   * resolved through {@link viewFor}.
   */
  get view(): CameraView2D | null {
    if (this.#space === 'world') return null
    return (this.#view ??= new Camera({ x: 0, y: 0, width: 1, height: 1 }))
  }

  /**
   * A layer with a space of its own is a root of that space, so its world
   * transform composes from nothing.
   */
  override get spatialParent(): Node2D | null {
    return this.#space === 'world' ? super.spatialParent : null
  }

  /**
   * Fit the view to a canvas of this CSS size. A frame layer fits its frame
   * into the canvas. A screen layer maps one unit to one pixel.
   *
   * @internal
   */
  _syncView(cssW: number, cssH: number): void {
    const view = this.view as Camera | null
    if (!view) return
    const space = this.#space
    view.setViewport(
      space === 'screen' || space === 'world'
        ? { x: 0, y: 0, width: cssW, height: cssH }
        : space.frame,
    )
    view.setPixelSize(cssW, cssH)
  }
}
