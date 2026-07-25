import { Renderer } from './Renderer'
import { GpuGfx } from './gfx/GpuGfx'
import type { TextureInspector } from './gfx/TextureManager'
import { WebGL2Device } from './gfx/webgl2/WebGL2Device'
import { Scene } from '../scene/Scene'
import { Camera } from '../camera/Camera'
import type { Rect } from '../math/Rect'
import type { Engine } from '../engine/Engine'
import { InputSystem } from '../input/InputSystem'
import type { PointerEvent2D } from '../input/PointerState'
import { createEmitter, type Emitter } from '../events/Emitter'
import { StageLayerRenderer } from './StageLayerRenderer'
import { PhysicsWorld, type PhysicsWorldConfig } from '../physics/PhysicsWorld'

/**
 * Construction options for a {@link Stage}. Every field is optional; the
 * defaults render an interactive-less 1000×1000 viewport.
 *
 * @category Render
 */
export interface StageOptions {
  /** World-space rect the camera frames. Default 1000×1000. */
  initialViewport?: Rect
  /** Solid clear color used when `transparent` is false. */
  clearColor?: string
  /** When true, `clear()` uses `clearRect` so the CSS parent shows through. */
  transparent?: boolean
  /**
   * Label in the debug HUD stage selector. Defaults to `Stage {N}`. The primary
   * stage is labelled "Primary" regardless.
   */
  name?: string
  /**
   * Attach an `InputSystem` so scene nodes receive pointer events. Default
   * `false` for secondary stages, primary is always `true`.
   */
  interactive?: boolean
  /**
   * Fires on canvas CSS-size and dpr changes, AFTER `renderer.resize` and
   * `camera.setPixelSize`. Use to reshape viewport or reposition anchored
   * nodes.
   */
  onResize?: (info: StageResizeInfo) => void
  /**
   * MSAA sample count. `1` disables, `>1` allocates a multisample
   * renderbuffer. Default 4, clamped to driver `MAX_SAMPLES`.
   */
  msaaSamples?: number
  /**
   * Attach a {@link PhysicsWorld} to this stage. `true` uses defaults; pass a
   * config to tune it. When set, the engine steps this world once per fixed
   * tick before the scene's `onFixedStep` pass. Default: no physics.
   */
  physics?: boolean | PhysicsWorldConfig
  /**
   * Test-only escape hatch: inject a prebuilt `GfxDevice` instead of
   * acquiring a real WebGL2 context. Lets Stage/Engine construct in a
   * DOM-only test environment (e.g. happy-dom, which returns `null` from
   * `canvas.getContext('webgl2')`) via `MockGfxDevice`. Not for app code.
   */
  gpuDevice?: import('./gfx/GfxDevice').GfxDevice
}

/**
 * Per-stage pointer events. Fires only on interactive stages. `pointerMove` is
 * high-frequency, do NOT bind Svelte stores to it. Use `$effect` listeners
 * instead.
 *
 * @category Render
 */
export interface StagePointerEvents {
  pointerDown: PointerEvent2D
  pointerMove: PointerEvent2D
  pointerUp: PointerEvent2D
  pointerCancel: PointerEvent2D
}

/**
 * Info passed to the resize callback so the owning `Engine` can emit its
 * `resize` engine-event without leaking the ResizeObserver upward.
 *
 * @category Render
 */
export interface StageResizeInfo {
  cssSize: { w: number; h: number }
  pixelSize: { w: number; h: number }
  dpr: number
}

const DEFAULT_VIEWPORT: Rect = { x: 0, y: 0, width: 1000, height: 1000 }

/**
 * A render surface (canvas + `Renderer` + `Scene` + `Camera`). All stages
 * share the engine's `Ticker` and `Animator` for drift-free synced tweens.
 *
 * @category Render
 */
export class Stage {
  readonly renderer: Renderer
  readonly scene: Scene
  readonly camera: Camera
  /** Owning canvas. Public so the debug controller / demos can reference it. */
  readonly canvas: HTMLCanvasElement
  /** Optional label shown in the debug HUD's stage selector. */
  readonly name: string | undefined
  /** Always constructed. Only fires on interactive stages. */
  readonly events: Emitter<StagePointerEvents> =
    createEmitter<StagePointerEvents>()
  /** `null` when the stage is display-only. */
  readonly input: InputSystem | null
  /** `null` unless `StageOptions.physics` was set. Stepped by the engine. */
  readonly physics: PhysicsWorld | null

  readonly #onResize?: (info: StageResizeInfo) => void
  #resizeObserver: ResizeObserver | null = null
  #disposed = false
  #active = true

  /** On-canvas rendering surface. */
  readonly #screenGfx: GpuGfx
  readonly #device: WebGL2Device | import('./gfx/GfxDevice').GfxDevice

  #prevCameraFrameNum = -1

  /** Per-layer node walk: viewport cull, transform compose, draw. */
  readonly #layerRenderer = new StageLayerRenderer()

  constructor(
    canvas: HTMLCanvasElement,
    engine: Engine,
    opts: StageOptions = {},
  ) {
    this.canvas = canvas
    this.name = opts.name
    this.#onResize = opts.onResize
    this.renderer = new Renderer({
      canvas,
      clearColor: opts.clearColor,
      transparent: opts.transparent,
    })
    // Kick the initial canvas size BEFORE the GL context is acquired so the
    // default framebuffer starts at the right pixel size.
    const rect = canvas.getBoundingClientRect()
    const initialCssW = rect.width || canvas.clientWidth || 1
    const initialCssH = rect.height || canvas.clientHeight || 1
    const initialDpr = window.devicePixelRatio || 1
    this.renderer.resize(initialCssW, initialCssH, initialDpr)
    this.#device = opts.gpuDevice ?? new WebGL2Device(canvas)
    this.#screenGfx = new GpuGfx(canvas, this.#device, {
      samples: opts.msaaSamples ?? 4,
    })
    this.#screenGfx.setInternalSize(
      this.renderer.pixelSize.w,
      this.renderer.pixelSize.h,
    )
    this.scene = new Scene()
    this.scene.engine = engine
    this.camera = new Camera(opts.initialViewport ?? DEFAULT_VIEWPORT)
    this.camera.engine = engine

    // Kiosk hygiene, touch/selection suppression on every canvas. Applied
    // here so Svelte-mounted secondary canvases inherit it.
    const style = canvas.style
    style.touchAction = 'none'
    style.userSelect = 'none'
    style.webkitUserSelect = 'none'
    style.setProperty('-webkit-touch-callout', 'none')
    style.outline = 'none'

    this.#applyResize()
    this.#resizeObserver = new ResizeObserver(() => this.#applyResize())
    this.#resizeObserver.observe(canvas)
    window.addEventListener('resize', this.#onWindowResize)

    // Input attaches last, needs renderer + camera in place. Debug
    // controller may still be null (set on Engine after primaryStage).
    this.input = opts.interactive ? new InputSystem(this, engine) : null

    if (opts.physics) {
      this.physics = new PhysicsWorld(
        opts.physics === true ? undefined : opts.physics,
      )
    } else {
      this.physics = null
    }
  }

  /**
   * Recompute local + world transforms across the scene. Skips clean subtrees
   * (both `_worldDirty` false AND parent world unchanged). See
   * `SceneNode.ensureWorldTransform` for the mid-frame escape hatch.
   */
  updateTransforms(): void {
    const root = this.scene.root
    const rootDirty = root.worldDirty
    if (rootDirty) {
      root.transform.updateLocal()
      const rl = root.transform.local
      const rw = root.transform.world
      rw.a = rl.a
      rw.b = rl.b
      rw.c = rl.c
      rw.d = rl.d
      rw.e = rl.e
      rw.f = rl.f
      root.markWorldClean()
    }
    const rw = root.transform.world
    const children = root.children
    for (let i = 0; i < children.length; i++) {
      this.#propagateTransform(children[i], rw, rootDirty)
    }
  }

  #propagateTransform(
    node: import('../scene/SceneNode').SceneNode,
    parentWorld: DOMMatrix,
    parentDirty: boolean,
  ): void {
    // If neither this node nor its parent changed since last frame, the
    // world matrix is still correct, skip the multiply.
    const nodeDirty = node.worldDirty || parentDirty
    if (nodeDirty) {
      node.transform.updateLocal()
      const l = node.transform.local
      const w = node.transform.world
      const pa = parentWorld.a
      const pb = parentWorld.b
      const pc = parentWorld.c
      const pd = parentWorld.d
      const pe = parentWorld.e
      const pf = parentWorld.f
      w.a = pa * l.a + pc * l.b
      w.b = pb * l.a + pd * l.b
      w.c = pa * l.c + pc * l.d
      w.d = pb * l.c + pd * l.d
      w.e = pa * l.e + pc * l.f + pe
      w.f = pb * l.e + pd * l.f + pf
      node.markWorldClean()
    }
    const children = node.children
    if (children.length === 0) return
    const w = node.transform.world
    for (let i = 0; i < children.length; i++) {
      this.#propagateTransform(children[i], w, nodeDirty)
    }
  }

  /**
   * Render this stage. Uses `camera` (defaults to `this.camera`) for projection
   * , the primary Engine passes its `activeCamera` so the debug camera can
   * drive the primary stage's view when toggled on.
   */
  render(dt: number, camera: Camera = this.camera): void {
    const { renderer } = this
    // Sync the camera's pixel size to this stage's canvas.
    camera.setPixelSize(renderer.cssSize.w, renderer.cssSize.h)

    const t = camera.getScreenTransform()
    if (t.scale <= 0) return

    const currentFN = camera.frameNum
    const camMovedSincePrevFrame = currentFN !== this.#prevCameraFrameNum
    this.#prevCameraFrameNum = currentFN
    void camMovedSincePrevFrame

    const dpr = renderer.dpr
    const dprScale = dpr * t.scale
    const vE = dpr * t.offsetX
    const vF = dpr * t.offsetY

    // Frame-phase perf marks, same `engine.perfMarks` opt-in as the per-node
    // marks in `drawLayer`, so `?debug=perf` brackets each render phase
    // (clear / static / above-static / dynamic) as a `performance.measure`.
    const marks = this.scene.engine?.perfMarks ?? false

    const screen = this.#screenGfx

    this.#phaseBegin(marks, 'clear')
    screen.beginFrame({
      clearColor: renderer.clearColor,
      transparent: renderer.transparent,
      pixelW: renderer.pixelSize.w,
      pixelH: renderer.pixelSize.h,
    })
    this.#phaseEnd(marks, 'clear')

    // Map Path2Ds are tessellated at asset load, so rendering the static
    // layer live every frame is one colored-tri batch (~5K tris). Sharper
    // than a bake + reproject and avoids CLAMP_TO_EDGE artifacts when the
    // viewport strays outside a stale bake's coverage.
    this.#phaseBegin(marks, 'static-render')
    this.#layerRenderer.drawLayer(
      this.scene,
      this.renderer,
      'static',
      screen,
      camera,
      dprScale,
      vE,
      vF,
      dt,
    )
    this.#phaseEnd(marks, 'static-render')
    screen.flush()

    this.#phaseBegin(marks, 'above-static')
    this.#layerRenderer.drawLayer(
      this.scene,
      this.renderer,
      'above-static',
      screen,
      camera,
      dprScale,
      vE,
      vF,
      dt,
    )
    this.#phaseEnd(marks, 'above-static')
    screen.flush()

    this.#phaseBegin(marks, 'dynamic')
    this.#layerRenderer.drawLayer(
      this.scene,
      this.renderer,
      'dynamic',
      screen,
      camera,
      dprScale,
      vE,
      vF,
      dt,
    )
    this.#phaseEnd(marks, 'dynamic')
    screen.flush()

    // Debug overlays draw INSIDE the frame so they composite on top of the
    // dynamic layer through the same gfx pipeline.
    const debug = this.scene.engine?.debug
    const activeDebugStage = debug?.activeStage ?? this
    if (debug && activeDebugStage === this) {
      this.#phaseBegin(marks, 'debug-overlay')
      debug.drawOverlay(this, camera, screen)
      this.#phaseEnd(marks, 'debug-overlay')
    }
    if (debug && this.input) {
      debug.drawInputOverlay(this, screen)
    }
    screen.flush()

    screen.endFrame()
  }

  /** Per-frame GPU pipeline stats. Read by the debug HUD. */
  get gpuStats(): {
    drawCalls: number
    programSwitches: number
    textureBinds: number
    blendSwitches: number
    overflowWarns: number
    sdfInstances: number
    strokeInstances: number
    roundRectInstances: number
    msaaSamples: number
  } {
    return this.#screenGfx.stats
  }

  /**
   * Read-only view of the GPU texture caches for the debug inspector. Built
   * on demand, no standing cost when unused.
   */
  get textureInspector(): TextureInspector {
    return this.#screenGfx.textureInspector
  }

  /**
   * Live-switch MSAA sample count on the GPU render target. Requested value
   * is clamped to the driver's `MAX_SAMPLES` inside the device.
   */
  setMsaaSamples(samples: number): void {
    this.#screenGfx.setSamples(samples)
  }

  /** Effective (post-clamp) MSAA sample count. */
  getMsaaSamples(): number {
    return this.#screenGfx.getSamples()
  }

  /**
   * Toggle a debug render mode. See `DebugRenderMode` for the modes and what
   * they visualise.
   */
  setDebugRenderMode(mode: import('./gfx/GpuGfx').DebugRenderMode): void {
    this.#screenGfx.setDebugRenderMode(mode)
  }

  /** Current debug render mode. */
  getDebugRenderMode(): import('./gfx/GpuGfx').DebugRenderMode {
    return this.#screenGfx.getDebugRenderMode()
  }

  /** Open a render-phase perf span. No-op unless `engine.perfMarks` is on. */
  #phaseBegin(marks: boolean, name: string): void {
    if (marks) performance.mark(`phase-${name}:start`)
  }

  /**
   * Close a phase span from `phaseBegin`, emits a `performance.measure`
   * surfaced by the Firefox Profiler. No-op unless `engine.perfMarks` is on.
   */
  #phaseEnd(marks: boolean, name: string): void {
    if (!marks) return
    performance.mark(`phase-${name}:end`)
    performance.measure(name, `phase-${name}:start`, `phase-${name}:end`)
  }

  /** Re-acquire the rendering context after a `webglcontextrestored` event. */
  reacquireContext(): void {
    this.#screenGfx.reacquireContext()
    this.#screenGfx.rebuildResources()
    this.scene.invalidateStatic()
  }

  #applyResize = (): void => {
    if (this.#disposed) return
    const rect = this.canvas.getBoundingClientRect()
    const cssW = rect.width
    const cssH = rect.height
    if (cssW === 0 || cssH === 0) return
    const dpr = window.devicePixelRatio
    if (
      cssW === this.renderer.cssSize.w &&
      cssH === this.renderer.cssSize.h &&
      dpr === this.renderer.dpr
    ) {
      return
    }
    this.renderer.resize(cssW, cssH, dpr)
    this.#screenGfx.setInternalSize(
      this.renderer.pixelSize.w,
      this.renderer.pixelSize.h,
    )
    this.camera.setPixelSize(cssW, cssH)
    this.scene.invalidateStatic()
    this.#onResize?.({
      cssSize: { ...this.renderer.cssSize },
      pixelSize: { ...this.renderer.pixelSize },
      dpr,
    })
  }

  #onWindowResize = (): void => this.#applyResize()

  /**
   * When false, the owning {@link Engine} skips this stage entirely each tick:
   * its scene isn't walked (`onUpdate` / `onFixedStep`), transforms aren't
   * propagated, and it isn't rendered. Flipping back to true resumes instantly
   * with no re-init or context churn. Primary stages stay active for their
   * whole lifetime; a secondary stage (e.g. a pre-warmed demo stage) can park
   * at zero per-frame cost when idle.
   *
   * NOTE: physics worlds step from the engine's GLOBAL registry, independent of
   * stage `active`. If a parked stage owns bodies, clear its scene (which
   * unregisters the world) before setting `active = false`, or they keep
   * stepping.
   */
  get active(): boolean {
    return this.#active
  }

  setActive(value: boolean): void {
    this.#active = value
  }

  dispose(): void {
    if (this.#disposed) return
    this.#disposed = true
    // Input FIRST so pointer capture clears before scene teardown would
    // synthesise cancels through captured nodes.
    this.input?.destroy()
    this.physics?.clear()
    this.#resizeObserver?.disconnect()
    this.#resizeObserver = null
    window.removeEventListener('resize', this.#onWindowResize)
    this.scene.root.destroy()
    // Tear down the WebGL2 device last, canvas listeners live on it.
    this.#device.destroy()
  }
}
