import {
  CameraNode2D,
  type EngineHost,
  type Rect,
  type Stage,
} from '@src/stargazer'
import type { DemoBuilder, DemoHandle, DemoStageController } from './types'
import { DEMO_DEBUG, demoLog } from './demoDebug'

/**
 * Fixed world rect the demo stage frames. 4:3, matching the media slot's aspect
 * (`--htp-media-w` : `--htp-media-h` in `HowToPlay.svelte`), so the world fills
 * the canvas with no letterbox and builders can lay out against a constant
 * rect. Read by builders as `stage.currentCamera2D.viewport`.
 */
const DEMO_VIEWPORT: Rect = { x: 0, y: 0, width: 1000, height: 750 }

/**
 * Warm-up canvas size while parked (non-zero so the GPU context + FBO
 * allocate).
 */
const PARK_W = 320
const PARK_H = 240

/**
 * Frames traced after each build, under `?debug=demo`.
 *
 * A blank card has four possible causes that all look the same from outside:
 * the stage is parked, it faulted, its 2D pass is skipped because the camera
 * resolves to a degenerate transform, or its nodes are culled. Only the render
 * frame knows which, so the trace reads the same values the frame does, on the
 * first frames after a build, and then goes quiet.
 */
const TRACE_FRAMES = 3

/**
 * One persistent, arcade-owned demo stage shared by every game's tutorial.
 * Created once at boot (behind the loading screen) so its WebGL2 context init
 * (a synchronous ~20 ms main-thread stall) never lands on a tap. Parked idle
 * (`stage.active = false`) between openings at zero per-frame cost. Revealed
 * into a modal's center slot on demand, its scene swapped per centered card.
 */
export class DemoStage implements DemoStageController {
  readonly #host: EngineHost
  readonly #stage: Stage
  /**
   * Off-screen parking spot. Keeps the canvas in the DOM so its context stays
   * live.
   */
  readonly #holder: HTMLDivElement
  readonly #canvas: HTMLCanvasElement
  #handle: DemoHandle | null = null
  #pendingBuild: DemoBuilder | null = null
  #built = false
  #destroyed = false
  /** Unsubscribe for the post-build frame trace, `?debug=demo` only. */
  #traceOff: (() => void) | null = null
  #traceLeft = 0

  constructor(host: EngineHost) {
    this.#host = host

    this.#holder = document.createElement('div')
    Object.assign(this.#holder.style, {
      position: 'fixed',
      left: '-10000px',
      top: '0',
      width: `${PARK_W}px`,
      height: `${PARK_H}px`,
      opacity: '0',
      pointerEvents: 'none',
    } satisfies Partial<CSSStyleDeclaration>)
    document.body.appendChild(this.#holder)

    this.#canvas = document.createElement('canvas')
    Object.assign(this.#canvas.style, {
      position: 'absolute',
      inset: '0',
      width: '100%',
      height: '100%',
      display: 'block',
      pointerEvents: 'none',
    } satisfies Partial<CSSStyleDeclaration>)
    this.#holder.appendChild(this.#canvas)

    // `interactive: false` so no input listeners. `transparent` so the modal
    // shows through the media slot.
    this.#stage = host.engine.attachStage(this.#canvas, {
      name: 'Tutorial Demo',
      interactive: false,
      transparent: true,
      // Revealing into a slot resizes the canvas. Build any pending demo once
      // it has a real backing size.
      onResize: () => {
        demoLog('stage resize')
        this.#tryBuild()
      },
    })
    // The demo stage's own camera, framing the fixed 4:3 demo rect. Intrinsic so
    // it survives the `destroyChildren()` sweep between demos.
    const cam = new CameraNode2D('demo-camera')
    cam.setViewport({ ...DEMO_VIEWPORT })
    cam.intrinsic = true
    this.#stage.tree.root.add(cam)
    cam.makeCurrent()
    this.#stage.setActive(false)
  }

  reveal(slot: HTMLElement): void {
    if (this.#destroyed) return
    slot.appendChild(this.#canvas)
    this.#stage.setActive(true)
    demoLog('reveal', {
      slot: { w: slot.clientWidth, h: slot.clientHeight },
      canvasPx: { ...this.#stage.renderer.pixelSize },
      active: this.#stage.active,
    })
  }

  setDemo(build: DemoBuilder | null): void {
    if (this.#destroyed) return
    this.#handle?.destroy()
    this.#handle = null
    this.#stage.tree.root.destroyChildren()
    this.#pendingBuild = build
    this.#built = false
    demoLog('setDemo', { hasBuild: build !== null })
    this.#tryBuild()
  }

  /**
   * Build the pending demo once the canvas has a real backing size. A 0×0
   * canvas clamps to 1×1 and would lay out wrong, so we wait for the reveal's
   * resize (`onResize`) to fire first.
   */
  #tryBuild(): void {
    if (this.#destroyed || this.#built || !this.#pendingBuild) {
      demoLog('tryBuild skipped', {
        destroyed: this.#destroyed,
        alreadyBuilt: this.#built,
        pending: this.#pendingBuild !== null,
      })
      return
    }
    const px = this.#stage.renderer.pixelSize
    if (px.w < 2 || px.h < 2) {
      demoLog('tryBuild deferred, canvas not sized', { px: { ...px } })
      return
    }
    this.#handle = this.#pendingBuild(this.#stage, this.#host)
    this.#built = true
    demoLog('built', {
      px: { ...px },
      active: this.#stage.active,
      children: this.#stage.tree.root.children.length,
    })
    this.#startTrace()
  }

  /** Watch the next few frames, then stop. A no-op unless the tracer is on. */
  #startTrace(): void {
    if (!DEMO_DEBUG) return
    this.#stopTrace()
    this.#traceLeft = TRACE_FRAMES
    this.#traceOff = this.#host.engine.events.on('frame', () => {
      if (this.#traceLeft <= 0) {
        this.#stopTrace()
        return
      }
      this.#traceLeft--
      this.#traceFrame()
    })
  }

  #stopTrace(): void {
    this.#traceOff?.()
    this.#traceOff = null
  }

  /**
   * Everything the render frame decides on, in one line.
   *
   * `det` is the determinant of the camera's screen affine, which the frame
   * requires to be non-zero and finite before it draws any 2D at all. A zero
   * there means the canvas has no CSS size yet, so the stage clears and stops,
   * which is exactly what a blank card looks like.
   *
   * `onScreen` covers the other half: a stage can draw a perfect frame into a
   * canvas the page is hiding, which looks the same to the person in front of
   * it and nothing engine-side can see.
   */
  #traceFrame(): void {
    const stage = this.#stage
    const r = stage.renderer
    const cam = stage.currentCamera2D
    const a = cam?.getScreenAffine()
    const dynamic = stage.tree.getLayerNodes('dynamic')
    const box = this.#canvas.getBoundingClientRect()
    const slot = this.#canvas.parentElement
    demoLog(`frame ${TRACE_FRAMES - this.#traceLeft}`, {
      active: stage.active,
      faulted: stage.faulted,
      css: { ...r.cssSize },
      px: { ...r.pixelSize },
      dpr: r.dpr,
      det: a ? a.a * a.d - a.b * a.c : null,
      visibleWorld: cam?.visibleWorldRect(),
      onScreen: {
        parent: slot?.className ?? null,
        box: { x: box.x, y: box.y, w: box.width, h: box.height },
        opacity: slot ? getComputedStyle(slot).opacity : null,
      },
      layers: {
        static: stage.tree.getLayerNodes('static').length,
        aboveStatic: stage.tree.getLayerNodes('above-static').length,
        dynamic: dynamic.length,
      },
      nodes: dynamic.map((n) => ({
        id: n.id,
        visible: n.visible,
        alpha: n.transform.alpha,
        bounds: n.debugBounds,
        at: { x: n.transform.world.e, y: n.transform.world.f },
      })),
    })
  }

  hide(): void {
    if (this.#destroyed) return
    this.#stopTrace()
    this.#handle?.destroy()
    this.#handle = null
    this.#pendingBuild = null
    this.#built = false
    this.#stage.tree.root.destroyChildren()
    this.#stage.setActive(false)
    // Park the canvas back off-screen so the context stays warm for reuse.
    this.#holder.appendChild(this.#canvas)
  }

  /** Arcade teardown: detach the stage (frees its GPU context) and drop the DOM. */
  destroy(): void {
    if (this.#destroyed) return
    this.#destroyed = true
    this.#stopTrace()
    this.#handle?.destroy()
    this.#handle = null
    this.#host.engine.detachStage(this.#stage)
    this.#holder.remove()
  }
}
