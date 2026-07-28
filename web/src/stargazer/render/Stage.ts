import { Renderer } from './Renderer'
import { GpuGfx } from './gfx/GpuGfx'
import type { TextureInspector, TextureSource } from './gfx/TextureManager'
import { WebGL2Device } from './gfx/webgl2/WebGL2Device'
import { SceneTree } from '../scene/SceneTree'
import type { CameraNode2D } from '../camera/CameraNode2D'
import type { CameraNode3D } from '../camera/CameraNode3D'
import type { Affine2x3, CameraView2D } from '../camera/CameraView2D'
import type { CameraView3D } from '../camera/CameraView3D'
import type { CameraHost } from '../camera/CameraHost'
import { MeshRenderer } from './gfx/MeshRenderer'
import { PostProcessPipeline } from './postfx/PostProcessPipeline'
import { DebugLine3DRenderer } from './gfx/DebugLine3DRenderer'
import { Viewport2DNode } from '../nodes/Viewport2DNode'
import { walkTree } from '../scene/traverse'
import type { Engine } from '../engine/Engine'
import { InputSystem } from '../input/InputSystem'
import type { PointerEvent2D } from '../input/PointerState'
import { createEmitter, type Emitter } from '../events/Emitter'
import { StageLayerRenderer } from './StageLayerRenderer'
import { PhysicsWorld, type PhysicsWorldConfig } from '../physics/PhysicsWorld'

/**
 * Construction options for a {@link Stage}. Every field is optional. A stage
 * starts with no camera; add a {@link CameraNode2D} and call `makeCurrent()`.
 *
 * @category Render
 */
export interface StageOptions {
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
   * MSAA sample count. `1` disables, `>1` allocates a multisample renderbuffer.
   * Default 4, clamped to driver `MAX_SAMPLES`.
   */
  msaaSamples?: number
  /**
   * Attach a {@link PhysicsWorld} to this stage. `true` uses defaults; pass a
   * config to tune it. When set, the engine steps this world once per fixed
   * tick before the scene's `onFixedStep` pass. Default: no physics.
   */
  physics?: boolean | PhysicsWorldConfig
  /**
   * Test-only escape hatch: inject a prebuilt `GfxDevice` instead of acquiring
   * a real WebGL2 context. Lets Stage/Engine construct in a DOM-only test
   * environment (e.g. happy-dom, which returns `null` from
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

/**
 * A render surface (canvas + `Renderer` + `Scene` + `Camera`). All stages share
 * the engine's `Ticker` and `Animator` for drift-free synced tweens.
 *
 * @category Render
 */
export class Stage implements CameraHost {
  readonly renderer: Renderer
  /**
   * The one scene tree holding both 2D and 3D content. Add nodes under
   * `tree.root`; the 2D and 3D render passes read from it, bucketed by node
   * kind.
   */
  readonly tree: SceneTree
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

  /** Per-layer node walk: viewport cull, transform compose, draw. */
  readonly #layerRenderer = new StageLayerRenderer()

  /** Set when a render frame threw; the stage then stops rendering. */
  #faulted = false

  /** Created lazily the first frame the stage has 3D content. */
  #meshRenderer: MeshRenderer | null = null
  /** Created lazily the first frame a 3D debug overlay is drawn. */
  #debugLines: DebugLine3DRenderer | null = null
  /** Created lazily on first `postProcess` access. */
  #postProcess: PostProcessPipeline | null = null

  // Camera registry (Godot Viewport model): registration-order arrays + the
  // current camera per dimension. Camera nodes register/unregister through the
  // CameraHost bridge on attach/detach.
  readonly #cameras2d: CameraNode2D[] = []
  readonly #cameras3d: CameraNode3D[] = []
  #current2d: CameraNode2D | null = null
  #current3d: CameraNode3D | null = null

  /**
   * Scratch device-pixel base affine (DPR · camera screen affine), reused each
   * frame.
   */
  readonly #renderAffine: Affine2x3 = { a: 0, b: 0, c: 0, d: 0, e: 0, f: 0 }
  readonly #scratchScreenAffine: Affine2x3 = {
    a: 0,
    b: 0,
    c: 0,
    d: 0,
    e: 0,
    f: 0,
  }

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
    this.tree = new SceneTree()
    this.tree.engine = engine
    // The camera host cameras register through on attach. No camera is created
    // automatically: add a `CameraNode2D` / `CameraNode3D` to the tree and call
    // `makeCurrent()`. Until then `currentCamera2D` is null and the stage renders
    // only the clear color.
    this.tree.stage = this

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
   * Recompose local + world transforms across the tree (2D in painter order,
   * then 3D), skipping clean nodes. See {@link SceneTree.updateTransforms}.
   */
  updateTransforms(): void {
    this.tree.updateTransforms()
  }

  // --- camera registry (CameraHost) -----------------------------------------

  /**
   * Current 2D camera, or `null` when no camera has been made current yet. The
   * stage renders only the clear color while this is null. Add a
   * {@link CameraNode2D} to the tree and call `makeCurrent()` to set it.
   */
  get currentCamera2D(): CameraNode2D | null {
    return this.#current2d
  }
  /** Current 3D camera, or `null` when none is current. */
  get currentCamera3D(): CameraNode3D | null {
    return this.#current3d
  }

  /**
   * All registered 2D cameras, in attachment order (read-only; for the debug
   * HUD).
   */
  get cameras2d(): readonly CameraNode2D[] {
    return this.#cameras2d
  }
  /**
   * All registered 3D cameras, in attachment order (read-only; for the debug
   * HUD).
   */
  get cameras3d(): readonly CameraNode3D[] {
    return this.#cameras3d
  }

  registerCamera2D(cam: CameraNode2D): void {
    if (this.#cameras2d.indexOf(cam) < 0) this.#cameras2d.push(cam)
    // First camera attached wins, or one that asked to be current before attach.
    if (!this.#current2d || cam.wantsCurrent) {
      cam.consumeWantsCurrent()
      this.#current2d = cam
    }
  }
  unregisterCamera2D(cam: CameraNode2D): void {
    const i = this.#cameras2d.indexOf(cam)
    if (i >= 0) this.#cameras2d.splice(i, 1)
    if (this.#current2d === cam) this.#current2d = this.#pickNext2D()
  }
  makeCurrent2D(cam: CameraNode2D): void {
    cam.consumeWantsCurrent()
    for (const c of this.#cameras2d) c.consumeWantsCurrent()
    this.#current2d = cam
  }
  isCurrent2D(cam: CameraNode2D): boolean {
    return this.#current2d === cam
  }
  reevaluateCurrent2D(): void {
    if (!this.#current2d || !this.#current2d.enabled) {
      this.#current2d = this.#pickNext2D()
    }
  }
  #pickNext2D(): CameraNode2D | null {
    let best: CameraNode2D | null = null
    for (const c of this.#cameras2d) {
      if (!c.enabled) continue
      if (!best || c.priority > best.priority) best = c
    }
    return best
  }

  registerCamera3D(cam: CameraNode3D): void {
    if (this.#cameras3d.indexOf(cam) < 0) this.#cameras3d.push(cam)
    if (!this.#current3d || cam.wantsCurrent) {
      cam.consumeWantsCurrent()
      this.#current3d = cam
    }
  }
  unregisterCamera3D(cam: CameraNode3D): void {
    const i = this.#cameras3d.indexOf(cam)
    if (i >= 0) this.#cameras3d.splice(i, 1)
    if (this.#current3d === cam) this.#current3d = this.#pickNext3D()
  }
  makeCurrent3D(cam: CameraNode3D): void {
    cam.consumeWantsCurrent()
    for (const c of this.#cameras3d) c.consumeWantsCurrent()
    this.#current3d = cam
  }
  isCurrent3D(cam: CameraNode3D): boolean {
    return this.#current3d === cam
  }
  reevaluateCurrent3D(): void {
    if (!this.#current3d || !this.#current3d.enabled) {
      this.#current3d = this.#pickNext3D()
    }
  }
  #pickNext3D(): CameraNode3D | null {
    let best: CameraNode3D | null = null
    for (const c of this.#cameras3d) {
      if (!c.enabled) continue
      if (!best || c.priority > best.priority) best = c
    }
    return best
  }

  /**
   * Wipe all non-intrinsic content from the tree. A convenience over
   * `tree.root.destroyChildren()`; the current cameras update as their nodes
   * detach (a scene rebuild should add and `makeCurrent()` its own camera).
   */
  clearScene(): void {
    this.tree.root.destroyChildren()
  }

  /**
   * Render this stage through its current 2D + 3D cameras. The debug HUD can
   * override either when it is driving this stage (see
   * `DebugController.activeCameraFor`).
   */
  render(dt: number): void {
    // A GPU-backend error (often a validation error while bringing up WebGPU)
    // throws synchronously from a device call and would otherwise re-throw every
    // frame, pegging the tab. Halt this stage on the first fault and surface it
    // once, rather than spinning.
    if (this.#faulted) return
    try {
      this.#renderFrame(dt)
    } catch (err) {
      this.#faulted = true
      console.error(
        '[stargazer] Stage render faulted and was halted to avoid a busy loop:',
        err,
      )
    }
  }

  #renderFrame(dt: number): void {
    const { renderer } = this
    const debug = this.tree.engine?.debug ?? null
    const dpr = renderer.dpr

    // Keep the current node camera's framing fit sized to the canvas. The debug
    // fly-camera, when active, is sized by the DebugController.
    this.currentCamera2D?.setPixelSize(renderer.cssSize.w, renderer.cssSize.h)

    // Resolve the active 2D camera (debug override or current, may be null) and
    // fold DPR onto its CSS-px screen affine. One path for node + debug cameras
    // (both are CameraView2D). A degenerate/absent camera skips the 2D pass but
    // the frame still clears.
    const cam2d: CameraView2D | null =
      debug?.activeCameraFor(this) ?? this.currentCamera2D
    const render = this.#renderAffine
    let draw2d = false
    if (cam2d) {
      const S = cam2d.getScreenAffine(this.#scratchScreenAffine)
      render.a = dpr * S.a
      render.b = dpr * S.b
      render.c = dpr * S.c
      render.d = dpr * S.d
      render.e = dpr * S.e
      render.f = dpr * S.f
      // Degenerate guard: singular / non-finite affine (zero viewport/pixel, or
      // a camera tweened through scale 0). Covers rotated/parented cameras too.
      const det = S.a * S.d - S.b * S.c
      draw2d =
        Math.abs(det) > 0 &&
        Number.isFinite(
          render.a + render.b + render.c + render.d + render.e + render.f,
        )
    }

    // Frame-phase perf marks, same `engine.perfMarks` opt-in as the per-node
    // marks in `drawLayer`, so `?debug=perf` brackets each render phase
    // (clear / static / above-static / dynamic) as a `performance.measure`.
    const marks = this.tree.engine?.perfMarks ?? false

    const screen = this.#screenGfx

    // Readiness gate: pipelines warm up asynchronously (a microtask on WebGL2,
    // longer on WebGPU). Skip the whole frame — no passes, no draws — until the
    // surface can render, rather than opening a pass with no pipelines.
    if (!screen.ready) return

    // Stand up the 3D pass when the world has 3D content or the 3D debug camera
    // is active. `has3D` skips intrinsic nodes; a pure-2D stage never enables it.
    const cam3d: CameraView3D | null =
      debug?.activeCamera3dFor(this) ?? this.currentCamera3D
    const has3D = this.tree.has3D
    const show3D = (has3D || (debug?.camera3dActive ?? false)) && cam3d !== null
    if (show3D) screen.enableDepth()
    if (has3D && cam3d && !this.#meshRenderer) {
      this.#meshRenderer = new MeshRenderer(
        screen.device,
        screen.targetColor,
        this.tree.engine?.quality,
        this.tree.engine?.fog,
      )
    }

    // Viewport2D pre-passes: render each embedded 2D scene to its own offscreen
    // target before the main frame begins, so the 3D pass can sample the result.
    if (has3D) {
      this.#phaseBegin(marks, '3d-rtt')
      walkTree(this.tree.root, (n) => {
        if (n instanceof Viewport2DNode && n.visible) {
          n.renderOffscreen(screen.device, this.canvas, dt)
        }
      })
      this.#phaseEnd(marks, '3d-rtt')
    }

    // Shadow pre-pass: render caster depth from each shadow-casting light into
    // the shadow maps. Runs before `beginFrame` so its FBO switch is undone when
    // `beginFrame` rebinds the screen target and viewport.
    if (has3D && this.#meshRenderer) {
      this.#meshRenderer.renderShadows(this.tree.root)
    }

    this.#phaseBegin(marks, 'clear')
    screen.beginFrame({
      clearColor: renderer.clearColor,
      transparent: renderer.transparent,
      pixelW: renderer.pixelSize.w,
      pixelH: renderer.pixelSize.h,
    })
    this.#phaseEnd(marks, 'clear')

    // Depth-tested 3D pass, drawn immediately into the freshly-cleared target
    // so the record/submit 2D layers replay on top. The 3D and 2D pipelines
    // each carry their own baked state, so no explicit state reset is needed
    // between the passes.
    if (show3D && cam3d) {
      this.#phaseBegin(marks, '3d')
      const ph = renderer.pixelSize.h
      cam3d.setAspect(ph > 0 ? renderer.pixelSize.w / ph : 1)
      if (has3D && this.#meshRenderer && this.#meshRenderer.ready) {
        // World matrices were composed in the engine's transform pass (or the
        // caller's) before render; just draw. Skipped until pipelines warm.
        this.#meshRenderer.render(
          cam3d,
          this.tree.root,
          debug?.meshShaderMode ?? 0,
        )
      }
      if (debug) {
        if (!this.#debugLines)
          this.#debugLines = new DebugLine3DRenderer(
            screen.device,
            screen.targetColor,
          )
        this.#debugLines.begin()
        debug.drawOverlay3D(this, cam3d, this.#debugLines)
        this.#debugLines.flush(cam3d.viewProjection)
      }
      this.#phaseEnd(marks, '3d')
    }

    // 2D layers only draw when a valid 2D camera is current. Map Path2Ds are
    // tessellated at asset load, so rendering the static layer live every frame
    // is one colored-tri batch (~5K tris), sharper than a bake + reproject.
    if (draw2d && cam2d) {
      this.#phaseBegin(marks, 'static-render')
      this.#layerRenderer.drawLayer(
        this.tree,
        this.renderer,
        'static',
        screen,
        cam2d,
        render,
        dt,
      )
      this.#phaseEnd(marks, 'static-render')
      screen.flush()

      this.#phaseBegin(marks, 'above-static')
      this.#layerRenderer.drawLayer(
        this.tree,
        this.renderer,
        'above-static',
        screen,
        cam2d,
        render,
        dt,
      )
      this.#phaseEnd(marks, 'above-static')
      screen.flush()

      this.#phaseBegin(marks, 'dynamic')
      this.#layerRenderer.drawLayer(
        this.tree,
        this.renderer,
        'dynamic',
        screen,
        cam2d,
        render,
        dt,
      )
      this.#phaseEnd(marks, 'dynamic')
      screen.flush()

      // Debug overlays draw INSIDE the frame so they composite on top of the
      // dynamic layer through the same gfx pipeline.
      const activeDebugStage = debug?.activeStage ?? this
      if (debug && activeDebugStage === this) {
        this.#phaseBegin(marks, 'debug-overlay')
        debug.drawOverlay(this, cam2d, screen)
        this.#phaseEnd(marks, 'debug-overlay')
      }
    }
    if (debug && this.input) {
      debug.drawInputOverlay(this, screen)
    }
    screen.flush()

    // Post-processing: when effects are active, submit the frame WITHOUT
    // blitting, then let the pipeline resolve/run/present. Otherwise keep the
    // direct present path (restoring it if effects were removed mid-run).
    const pp = this.#postProcess
    if (pp && pp.active) {
      screen.setPresent(false)
      screen.endFrame()
      pp.run(screen.target, {
        canvasW: this.canvas.width,
        canvasH: this.canvas.height,
        dt,
      })
    } else {
      screen.setPresent(true)
      screen.endFrame()
    }
  }

  /**
   * Screen-space post-processing chain for this stage (chromatic aberration,
   * vignette, custom {@link PostEffect}s). Created on first access; a stage that
   * never touches it allocates nothing and keeps the direct present path.
   */
  get postProcess(): PostProcessPipeline {
    if (!this.#postProcess) {
      this.#postProcess = new PostProcessPipeline(this.#device)
    }
    return this.#postProcess
  }

  /**
   * Last-frame 3D mesh draw counts (draws/visible/vertices/triangles), or
   * `null` when no 3D pass has run on this stage. Read by the debug HUD.
   */
  get render3dStats(): {
    draws: number
    visible: number
    vertices: number
    triangles: number
  } | null {
    return this.#meshRenderer?.stats ?? null
  }

  /** Which rendering backend this stage's device is. Read by the debug HUD. */
  get backend(): import('./gfx/GfxDevice').GfxBackend {
    return this.#device.backend
  }

  /** The stage's rendering device. The host reads it to wire loss recovery. */
  get device(): import('./gfx/GfxDevice').GfxDevice {
    return this.#device
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
   * Read-only view of the GPU texture caches for the debug inspector. Built on
   * demand, no standing cost when unused.
   */
  get textureInspector(): TextureInspector {
    return this.#screenGfx.textureInspector
  }

  /**
   * Every inspectable render target on this stage: the screen plus each
   * `Viewport2DNode`'s offscreen surface (once it has rendered). Each keeps its
   * own `TextureManager`, so the debug HUD lists them as labeled sources.
   */
  get textureSources(): TextureSource[] {
    const out: TextureSource[] = [
      {
        id: 'screen',
        label: 'Screen',
        inspector: this.#screenGfx.textureInspector,
      },
    ]
    walkTree(this.tree.root, (n) => {
      if (n instanceof Viewport2DNode) {
        const inspector = n.textureInspector
        if (inspector)
          out.push({ id: n.id, label: `Viewport2D · ${n.id}`, inspector })
      }
    })
    const modelInspector = this.#meshRenderer?.textureInspector
    if (modelInspector)
      out.push({ id: 'models', label: '3D models', inspector: modelInspector })
    return out
  }

  /**
   * Live-switch MSAA sample count on the GPU render target. Requested value is
   * clamped to the driver's `MAX_SAMPLES` inside the device.
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
    this.tree.invalidateStatic()
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
    // Keep every registered 2D camera sized to the canvas, so one that later
    // becomes current already has the correct framing fit.
    for (const c of this.#cameras2d) c.setPixelSize(cssW, cssH)
    this.tree.invalidateStatic()
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
    this.tree.destroy()
    this.#meshRenderer?.destroy()
    this.#meshRenderer = null
    this.#debugLines?.destroy()
    this.#debugLines = null
    this.#postProcess?.destroy()
    this.#postProcess = null
    // Tear down the WebGL2 device last, canvas listeners live on it.
    this.#device.destroy()
  }
}
