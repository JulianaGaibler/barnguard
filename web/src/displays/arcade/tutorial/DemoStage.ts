import type { EngineHost, Rect, Stage } from '@src/stargazer'
import type { DemoBuilder, DemoHandle, DemoStageController } from './types'

/**
 * Fixed world rect the demo stage frames. 4:3, matching the media slot's aspect
 * (`--htp-media-w` : `--htp-media-h` in `HowToPlay.svelte`), so the world fills
 * the canvas with no letterbox and builders can lay out against a constant
 * rect. Read by builders as `stage.camera.viewport`.
 */
const DEMO_VIEWPORT: Rect = { x: 0, y: 0, width: 1000, height: 750 }

/**
 * Warm-up canvas size while parked (non-zero so the GPU context + FBO
 * allocate).
 */
const PARK_W = 320
const PARK_H = 240

/**
 * One persistent, arcade-owned demo stage shared by every game's tutorial.
 * Created once at boot (behind the loading screen) so its WebGL2 context init —
 * a synchronous ~20 ms main-thread stall — never lands on a tap. Parked idle
 * (`stage.active = false`) between openings at zero per-frame cost; revealed
 * into a modal's center slot on demand, its scene swapped per centered card.
 */
export class DemoStage implements DemoStageController {
  readonly #host: EngineHost
  readonly #stage: Stage
  /**
   * Off-screen parking spot; keeps the canvas in the DOM so its context stays
   * live.
   */
  readonly #holder: HTMLDivElement
  readonly #canvas: HTMLCanvasElement
  #handle: DemoHandle | null = null
  #pendingBuild: DemoBuilder | null = null
  #built = false
  #destroyed = false

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

    // `interactive: false` so no input listeners; `transparent` so the modal
    // shows through the media slot.
    this.#stage = host.engine.attachStage(this.#canvas, {
      name: 'Tutorial Demo',
      interactive: false,
      transparent: true,
      initialViewport: { ...DEMO_VIEWPORT },
      // Revealing into a slot resizes the canvas; build any pending demo once
      // it has a real backing size.
      onResize: () => this.#tryBuild(),
    })
    this.#stage.setActive(false)
  }

  reveal(slot: HTMLElement): void {
    if (this.#destroyed) return
    slot.appendChild(this.#canvas)
    this.#stage.setActive(true)
  }

  setDemo(build: DemoBuilder | null): void {
    if (this.#destroyed) return
    this.#handle?.destroy()
    this.#handle = null
    this.#stage.scene.root.destroyChildren()
    this.#pendingBuild = build
    this.#built = false
    this.#tryBuild()
  }

  /**
   * Build the pending demo once the canvas has a real backing size. A 0×0
   * canvas clamps to 1×1 and would lay out wrong, so we wait for the reveal's
   * resize (`onResize`) to fire first.
   */
  #tryBuild(): void {
    if (this.#destroyed || this.#built || !this.#pendingBuild) return
    const px = this.#stage.renderer.pixelSize
    if (px.w < 2 || px.h < 2) return
    this.#handle = this.#pendingBuild(this.#stage, this.#host)
    this.#built = true
  }

  hide(): void {
    if (this.#destroyed) return
    this.#handle?.destroy()
    this.#handle = null
    this.#pendingBuild = null
    this.#built = false
    this.#stage.scene.root.destroyChildren()
    this.#stage.setActive(false)
    // Park the canvas back off-screen so the context stays warm for reuse.
    this.#holder.appendChild(this.#canvas)
  }

  /** Arcade teardown: detach the stage (frees its GPU context) and drop the DOM. */
  destroy(): void {
    if (this.#destroyed) return
    this.#destroyed = true
    this.#handle?.destroy()
    this.#handle = null
    this.#host.engine.detachStage(this.#stage)
    this.#holder.remove()
  }
}
