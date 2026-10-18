import type { RetainedCacheStats } from './gfx/RetainedCache'
import { Renderer } from './Renderer'
import { GpuGfx } from './gfx/GpuGfx'
import type { GpuGfxStats } from './gfx/GpuBatchContext'
import type { GfxSurfaceEffects } from './gfx/Gfx2D'
import type { TextureInspector, TextureSource } from './gfx/TextureManager'
import { WebGL2Device } from './gfx/webgl2/WebGL2Device'
import { SceneTree } from '../scene/SceneTree'
import type { CameraNode2D } from '../camera/CameraNode2D'
import type { CameraNode3D } from '../camera/CameraNode3D'
import type { Affine2x3, CameraView2D } from '../camera/CameraView2D'
import type { CameraView3D } from '../camera/CameraView3D'
import type { CameraHost } from '../camera/CameraHost'
import { MeshRenderer } from './gfx/MeshRenderer'
import { RenderFailures } from './gfx/RenderFailures'
import { PostProcessPipeline } from './postfx/PostProcessPipeline'
import { AmbientOcclusion } from './gfx/ao/AmbientOcclusion'
import { DebugLine3DRenderer } from './gfx/DebugLine3DRenderer'
import type { Engine } from '../engine/Engine'
import { InputSystem } from '../input/InputSystem'
import type { PointerEvent2D } from '../input/PointerState'
import { createEmitter, type Emitter } from '../events/Emitter'
import { ComposeWalk } from './ComposeWalk'
import { PhysicsWorld, type PhysicsWorldConfig } from '../physics/PhysicsWorld'

const MIN_RENDER_SCALE = 0.1
const MAX_RENDER_SCALE = 2

/**
 * Construction options for a {@link Stage}. Every field is optional. A stage
 * starts with no camera. Add a {@link CameraNode2D} and call `makeCurrent()`.
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
   * Draw the frame in the canvas's own format, so its last pass writes the
   * canvas with no copy afterwards. Default true. `false` keeps the frame in a
   * target of its own that is copied to the canvas, which lets the two be
   * compared on a given GPU.
   */
  directPresent?: boolean
  /**
   * Attach a {@link PhysicsWorld} to this stage. `true` uses defaults, pass a
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
  /**
   * Multiplies `devicePixelRatio` before every resize, shrinking the canvas
   * backing store (the CSS size is unchanged, so the browser upscales). Default
   * `1`. Clamped to `[0.1, 2]`. A per-machine quality knob for a stage whose
   * whole render cost (scene, post-processing) scales with pixel count, cheaper
   * than tuning any one effect's own resolution.
   */
  renderScale?: number
  /**
   * Render at exactly this many device pixels, whatever the canvas's CSS size,
   * `devicePixelRatio` or `renderScale`. The 2D cameras see the same size as
   * their CSS size. A stage with a fixed size does not watch its canvas for
   * resizes, so the canvas need not be in the document.
   */
  fixedPixelSize?: StagePixelSize
  /**
   * Rasterize every text label at its exact size on every frame. By default a
   * label whose scale is changing keeps drawing from a nearby raster until the
   * scale settles, which keeps a zoom smooth but shows the label slightly soft
   * for a few frames. Set this for a stage whose frames are separate stills
   * rather than one animation. Default `false`.
   */
  exactText?: boolean
}

/** A width and height in device pixels. */
export interface StagePixelSize {
  width: number
  height: number
}

/**
 * Per-stage pointer events. Fires only on interactive stages. `pointerMove` is
 * high-frequency, do NOT bind Svelte stores to it. Use `$effect` listeners
 * instead.
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
 */
export interface StageResizeInfo {
  cssSize: { w: number; h: number }
  pixelSize: { w: number; h: number }
  dpr: number
}

/**
 * A render surface: one canvas with its own {@link Renderer}, {@link SceneTree},
 * cameras, and render pipeline. The engine owns a primary stage, and every
 * extra stage shares the engine's `Ticker` and `Animator`, so tweens across
 * canvases stay in step.
 *
 * @example
 *   // A second canvas, driven by the same clock.
 *   const stage = engine.attachStage(previewCanvas, {
 *     clearColor: '#101018',
 *     interactive: true,
 *   })
 *   const cam = new CameraNode2D()
 *   cam.setViewport({ x: 0, y: 0, width: 640, height: 360 })
 *   stage.tree.root.add(cam)
 *   cam.makeCurrent()
 *   // Park it when it goes off screen, at no per-frame cost.
 *   stage.setActive(false)
 */
export class Stage implements CameraHost {
  readonly renderer: Renderer
  /**
   * The one scene tree holding both 2D and 3D content. Add nodes under
   * `tree.root`. The 2D and 3D render passes read from it, bucketed by node
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
  /**
   * GPU resources this stage could not build. Also reported on `engine.events`
   * as `renderfailure`.
   */
  readonly failures = new RenderFailures()
  /** `null` when the stage is display-only. */
  readonly input: InputSystem | null
  /** `null` unless `StageOptions.physics` was set. Stepped by the engine. */
  readonly physics: PhysicsWorld | null

  readonly #onResize?: (info: StageResizeInfo) => void
  #resizeObserver: ResizeObserver | null = null
  #disposed = false
  #active = true
  #renderScale: number
  #fixedPixelSize: StagePixelSize | null

  /** On-canvas rendering surface. */
  readonly #screenGfx: GpuGfx
  readonly #device: WebGL2Device | import('./gfx/GfxDevice').GfxDevice

  /** Per-layer node walk: viewport cull, transform compose, draw. */
  readonly #composeWalk = new ComposeWalk()

  /** Set when a render frame threw. The stage then stops rendering. */
  #faulted = false

  /** Created lazily the first frame the stage has 3D content. */
  #meshRenderer: MeshRenderer | null = null
  /** Created lazily the first frame a 3D debug overlay is drawn. */
  #debugLines: DebugLine3DRenderer | null = null
  /** Created lazily on first `postProcess` access. */
  #postProcess: PostProcessPipeline | null = null
  /** Created lazily on first `ambientOcclusion` access. */
  #ambientOcclusion: AmbientOcclusion | null = null

  // Camera registry: registration-order arrays plus the
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
    this.#renderScale = Math.min(
      MAX_RENDER_SCALE,
      Math.max(MIN_RENDER_SCALE, opts.renderScale ?? 1),
    )
    this.renderer = new Renderer({
      canvas,
      clearColor: opts.clearColor,
      transparent: opts.transparent,
    })
    this.#fixedPixelSize = opts.fixedPixelSize
      ? { ...opts.fixedPixelSize }
      : null
    // Kick the initial canvas size BEFORE the device is acquired so the
    // default framebuffer starts at the right pixel size.
    const initial = this.#targetSize()
    this.renderer.resize(initial.cssW || 1, initial.cssH || 1, initial.dpr)
    this.#device = opts.gpuDevice ?? new WebGL2Device(canvas)
    this.#screenGfx = new GpuGfx(canvas, this.#device, {
      samples: opts.msaaSamples ?? 4,
      canvas: opts.directPresent ?? true,
      // Backs the deduplicated translucent-stroke path. Fixed here because a
      // pipeline bakes its depth-stencil format, so it cannot be turned on
      // later without re-warming every 2D pipeline. Dropped again if the stage
      // turns on depth for a 3D pass (see `GpuGfx.enableDepth`).
      stencil: true,
      vectorQuality: engine.quality.vector,
      failures: this.failures,
      holdLabels: !opts.exactText,
    })
    this.failures.onReport((f) => engine.events.emit('renderfailure', f))
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
    if (!this.#fixedPixelSize) this.#watchCanvasSize()

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
   * Compile the pipelines a layer's effects need, for this stage's surface.
   *
   * @internal
   */
  _warmEffects(fx: GfxSurfaceEffects): void {
    this.#screenGfx.warmEffects(fx)
  }

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
   * All registered 2D cameras, in attachment order (read-only, for the debug
   * HUD).
   */
  get cameras2d(): readonly CameraNode2D[] {
    return this.#cameras2d
  }
  /**
   * All registered 3D cameras, in attachment order (read-only, for the debug
   * HUD).
   */
  get cameras3d(): readonly CameraNode3D[] {
    return this.#cameras3d
  }

  /** Called by a {@link CameraNode2D} when it attaches. Not for game code. */
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

  /** Called by a {@link CameraNode3D} when it attaches. Not for game code. */
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
   * `tree.root.destroyChildren()`. The current cameras update as their nodes
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
    // throws synchronously from a device call and would otherwise re-throw
    // every frame, pegging the tab. Halt this stage on the first fault and
    // surface it once, rather than spinning.
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
    // (clear / draw2d / debug-overlay) as a `performance.measure`.
    const marks = this.tree.engine?.perfMarks ?? false

    const screen = this.#screenGfx
    screen.perfMarks = marks

    // Stand up the 3D pass when the world has 3D content or the 3D debug camera
    // is active. `has3D` skips intrinsic nodes, a pure-2D stage never enables it.
    const cam3d: CameraView3D | null =
      debug?.activeCamera3dFor(this) ?? this.currentCamera3D
    const has3D = this.tree.has3D
    const show3D = (has3D || (debug?.camera3dActive ?? false)) && cam3d !== null

    // Depth is attached for as long as the scene holds 3D content and released
    // when it stops. A stage outlives the scenes drawn on it, so holding the
    // attachment after the last 3D node keeps it for the rest of the booth's
    // life. `has3D` is structural rather than visibility-based, so this does
    // not toggle while a scene hides its meshes.
    //
    // Ahead of the readiness gate on purpose. Swapping the attachment
    // invalidates every pipeline baked against the old one, so the frame that
    // triggers the swap has to be the frame that is skipped.
    if (show3D) screen.enableDepth()
    else screen.disableDepth()

    // Readiness gate: pipelines warm up asynchronously (a microtask on WebGL2,
    // longer on WebGPU). Skip the whole frame, no passes, no draws, until the
    // surface can render, rather than opening a pass with no pipelines.
    if (!screen.ready) return

    // Path-shadow bake pre-pass: outside the has3D guards below (and
    // outside the has3D check entirely) since it must run on every stage,
    // including a pure-2D one, and its own render passes cannot nest inside
    // the main 2D pass `screen.beginFrame` is about to open.
    screen.processPendingShadowBakes()

    if (has3D && cam3d && !this.#meshRenderer) {
      this.#meshRenderer = new MeshRenderer(
        screen.device,
        screen.targetFormat,
        this.tree.engine?.quality,
        this.tree.engine?.fog,
        this.failures,
      )
    } else {
      // A renderer built against a previous attachment rebuilds its pipelines
      // here. No-op while the signature is unchanged.
      this.#meshRenderer?.retarget(screen.targetFormat)
    }
    this.#debugLines?.retarget(screen.targetFormat)

    // One walk of the 3D tree gathers what the shadow, AO and main passes draw.
    if (has3D && this.#meshRenderer) this.#meshRenderer.collect(this.tree.root)

    // Shadow pre-pass: render caster depth from each shadow-casting light into
    // the shadow maps. Runs before `beginFrame` so its FBO switch is undone when
    // `beginFrame` rebinds the screen target and viewport.
    if (has3D && this.#meshRenderer) {
      this.#meshRenderer.renderShadows(this.tree.root)
    }

    // Ambient-occlusion pre-pass: fill the G-buffer and estimate occlusion into
    // a texture the main pass samples. Same pre-`beginFrame` window as shadows.
    // Read the controller through the private field so a pure-2D stage never
    // constructs it. The mesh renderer gets the AO texture (or null when off).
    const ao = this.#ambientOcclusion
    const aoActive =
      has3D &&
      cam3d !== null &&
      this.#meshRenderer !== null &&
      (ao?.enabled ?? false)
    if (aoActive && ao && cam3d && this.#meshRenderer) {
      this.#phaseBegin(marks, 'ao')
      ao.run(
        cam3d,
        this.tree.root,
        this.#meshRenderer,
        renderer.pixelSize.w,
        renderer.pixelSize.h,
      )
      this.#phaseEnd(marks, 'ao')
    }
    if (this.#meshRenderer) {
      this.#meshRenderer.setAmbientOcclusion(
        aoActive && ao ? ao.aoTexture : null,
        aoActive,
        renderer.pixelSize.w,
        renderer.pixelSize.h,
        ao?.directStrength ?? 0,
      )
    }

    // Post-processing presents the frame itself, so the frame is drawn for it
    // to read. Otherwise the main pass resolves straight into the canvas. The
    // choice is made here because it decides where that pass resolves.
    const pp = this.#postProcess
    const postFx = !!pp && pp.active
    screen.setPresent(!postFx)

    this.#phaseBegin(marks, 'clear')
    screen.beginFrame({
      clearColor: renderer.clearColor,
      transparent: renderer.transparent,
      pixelW: renderer.pixelSize.w,
      pixelH: renderer.pixelSize.h,
    })
    this.#phaseEnd(marks, 'clear')

    // The depth-tested 3D draws run when the frame is submitted, at the start
    // of the main pass and before the recorded 2D layers. The 3D and 2D
    // pipelines each carry their own baked state, so no explicit state reset
    // is needed between them.
    if (show3D && cam3d) {
      const ph = renderer.pixelSize.h
      cam3d.setAspect(ph > 0 ? renderer.pixelSize.w / ph : 1)
      const meshes =
        has3D && this.#meshRenderer && this.#meshRenderer.ready
          ? this.#meshRenderer
          : null
      let lines: DebugLine3DRenderer | null = null
      if (debug) {
        if (!this.#debugLines)
          this.#debugLines = new DebugLine3DRenderer(
            screen.device,
            screen.targetFormat,
          )
        lines = this.#debugLines
        lines.begin()
        debug.drawOverlay3D(this, cam3d, lines)
      }
      const root = this.tree.root
      const shaderMode = debug?.meshShaderMode ?? 0
      screen.setMainPrelude(() => {
        this.#phaseBegin(marks, '3d')
        // World matrices were composed in the engine's transform pass (or the
        // caller's) before render, so this just draws.
        meshes?.render(cam3d, root, shaderMode)
        lines?.flush(cam3d.viewProjection)
        this.#phaseEnd(marks, '3d')
      })
    }

    // 2D content only draws when a valid 2D camera is current. Map Path2Ds are
    // tessellated at asset load, so drawing them live every frame is one
    // colored-tri batch (~5K tris), sharper than a bake + reproject.
    if (draw2d && cam2d) {
      this.#phaseBegin(marks, 'draw2d')
      this.#composeWalk.draw(
        this.tree,
        this.renderer,
        screen,
        cam2d,
        render,
        dt,
      )
      this.#phaseEnd(marks, 'draw2d')
      screen.flush()

      // Debug overlays draw INSIDE the frame so they composite on top of the
      // 2D content through the same gfx pipeline.
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

    // Post-processing: when effects are active, the scene is not presented. The
    // pipeline reads it, writes the canvas, and the frame is submitted once it
    // has run.
    screen.endFrame()
    if (pp && postFx) {
      pp.run(screen.target, {
        canvasW: this.canvas.width,
        canvasH: this.canvas.height,
        dt,
        pxPerUnit: this.renderer.dpr,
      })
      screen.device.endFrame()
    }
    screen.captureFrameCounters()
  }

  /**
   * Screen-space post-processing chain for this stage (chromatic aberration,
   * vignette, custom {@link PostEffect}s). Created on first access. A stage that
   * never touches it allocates nothing and keeps the direct present path.
   */
  get postProcess(): PostProcessPipeline {
    if (!this.#postProcess) {
      this.#postProcess = new PostProcessPipeline(this.#device)
    }
    return this.#postProcess
  }

  /**
   * Screen-space ambient occlusion for the 3D pass. Created on first access.
   * Enable it with `stage.ambientOcclusion.enabled = true`. A stage that never
   * touches it allocates nothing and runs no AO passes.
   */
  get ambientOcclusion(): AmbientOcclusion {
    if (!this.#ambientOcclusion) {
      this.#ambientOcclusion = new AmbientOcclusion(this.#device)
    }
    return this.#ambientOcclusion
  }

  /**
   * The AO controller only if already created, without constructing it, so a
   * debug panel can read its state each frame without warming AO pipelines on a
   * stage that never enabled it.
   */
  peekAmbientOcclusion(): AmbientOcclusion | null {
    return this.#ambientOcclusion
  }

  /**
   * Last-frame 3D mesh draw counts (draws/visible/vertices/triangles), or
   * `null` when no 3D pass has run on this stage. Read by the debug HUD.
   */
  get render3dStats(): {
    draws: number
    visible: number
    culled: number
    vertices: number
    triangles: number
    shadowPasses: number
  } | null {
    return this.#meshRenderer?.stats ?? null
  }

  /** Which backend this stage's device is, `'webgpu'` or `'webgl2'`. */
  get backend(): import('./gfx/GfxDevice').GfxBackend {
    return this.#device.backend
  }

  /** The stage's rendering device. The host reads it to wire loss recovery. */
  get device(): import('./gfx/GfxDevice').GfxDevice {
    return this.#device
  }

  /**
   * Draw counts for the frame just rendered, reset at each `beginFrame`. The
   * switch counts come from the device after redundant-call elision, so they
   * reflect work actually done.
   */
  get gpuStats(): GpuGfxStats {
    return this.#screenGfx.stats
  }

  /** What the renderer's retained caches hold and did last frame. */
  cacheStats(): RetainedCacheStats[] {
    return this.#screenGfx.cacheStats()
  }

  /**
   * What the 2D walk did last frame: nodes it drew, pictures it painted and
   * replayed, and nodes it culled.
   */
  get composeStats(): {
    readonly nodes: number
    readonly paints: number
    readonly replays: number
    readonly culled: number
  } {
    return this.#composeWalk.stats
  }

  /**
   * Bytes each picture streamed to the GPU last frame, by node class and id.
   * Development only.
   */
  get composeStreamers(): ReadonlyMap<string, number> {
    return this.#composeWalk.streamers
  }

  /** Pictures painted last frame, counted by node class. */
  get composePainters(): ReadonlyMap<string, number> {
    return this.#composeWalk.painters
  }

  /** What the 2D walk has done since the stage started. */
  get composeTotals(): {
    readonly frames: number
    readonly framesPainted: number
    readonly paints: number
    readonly stale: number
  } {
    return this.#composeWalk.totals
  }

  /**
   * Whether the renderer joins draws that can be drawn together across draws
   * they share no pixels with. On by default. Turn it off to compare against
   * one draw per run.
   */
  get mergeRuns(): boolean {
    return this.#screenGfx.mergeRuns
  }
  set mergeRuns(on: boolean) {
    this.#screenGfx.mergeRuns = on
  }

  /**
   * Bake path-shadow masks for device scales this stage's camera has not
   * reached yet, which is what keeps a shadow from stepping into place over the
   * frames after a zoom. `factors` are multiples of the scale each shadow is
   * drawn at now: see `GpuGfx.warmPathShadows` for the detail.
   *
   * @example
   *   // The framings a tap can zoom to, relative to the one on screen.
   *   stage.warmPathShadows([playScale / idleScale])
   */
  warmPathShadows(factors: readonly number[]): void {
    this.#screenGfx.warmPathShadows(factors)
  }

  /**
   * Warm-up bakes still queued behind the per-frame bake budget. Zero once
   * every mask `warmPathShadows` asked for is cached.
   */
  get pendingPathShadowWarmups(): number {
    return this.#screenGfx.pendingPathShadowWarmups
  }

  /**
   * Read-only view of the GPU texture caches for the debug inspector. Built on
   * demand, no standing cost when unused.
   */
  get textureInspector(): TextureInspector {
    return this.#screenGfx.textureInspector
  }

  /**
   * Every inspectable texture source on this stage: the screen and the loaded
   * 3D models. The debug HUD lists them as labeled sources.
   */
  get textureSources(): TextureSource[] {
    const out: TextureSource[] = [
      {
        id: 'screen',
        label: 'Screen',
        inspector: this.#screenGfx.textureInspector,
      },
    ]
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
    // The 3D pipelines bake the target's sample count, so re-point them at the
    // resized target. Each drops `ready` and re-warms. The 3D pass is gated on
    // `ready`, so it is skipped until the new-sample pipelines are live.
    this.#meshRenderer?.retarget(this.#screenGfx.targetFormat)
    this.#debugLines?.retarget(this.#screenGfx.targetFormat)
  }

  /**
   * The factor applied to `devicePixelRatio` before every resize, in `[0.1,
   * 2]`. Setting it resizes the backing store now. A stage with a
   * {@link fixedPixelSize} keeps the value but does not apply it.
   */
  get renderScale(): number {
    return this.#renderScale
  }
  set renderScale(scale: number) {
    this.#renderScale = Math.min(
      MAX_RENDER_SCALE,
      Math.max(MIN_RENDER_SCALE, scale),
    )
    this.#applyResize()
  }

  /** MSAA sample count actually in use, after the driver clamp. */
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

  /**
   * Throw away every rasterized label so text is re-shaped next frame.
   *
   * For when a webfont finishes loading after text has already been drawn. The
   * label atlas holds bitmaps rasterized with the fallback face, so they all
   * have to go. Callers should also clear the measurement caches
   * (`clearFontMetricsCache`, `clearTextLayoutCaches`), which hold fallback
   * metrics and so mislay text rather than merely restyling it.
   *
   * This cannot fix a font string or a measurement captured once in a node's
   * constructor. Loading fonts before the first frame is the real answer, and
   * this is the degradation path.
   */
  invalidateText(): void {
    this.#screenGfx.clearLabelCache()
  }

  /** Re-acquire the rendering context after a `webglcontextrestored` event. */
  reacquireContext(): void {
    this.#screenGfx.reacquireContext()
    this.#screenGfx.rebuildResources()
  }

  #watchCanvasSize(): void {
    this.#resizeObserver = new ResizeObserver(() => this.#applyResize())
    this.#resizeObserver.observe(this.canvas)
    window.addEventListener('resize', this.#onWindowResize)
  }

  /** The CSS size and pixel ratio the stage renders at right now. */
  #targetSize(): { cssW: number; cssH: number; dpr: number } {
    const fixed = this.#fixedPixelSize
    if (fixed) return { cssW: fixed.width, cssH: fixed.height, dpr: 1 }
    const rect = this.canvas.getBoundingClientRect()
    return {
      cssW: rect.width || this.canvas.clientWidth,
      cssH: rect.height || this.canvas.clientHeight,
      dpr: (window.devicePixelRatio || 1) * this.#renderScale,
    }
  }

  /**
   * Render at exactly `width` × `height` device pixels from now on, as
   * {@link StageOptions.fixedPixelSize} does. The stage stops following its
   * canvas's CSS size.
   */
  setFixedPixelSize(width: number, height: number): void {
    if (!this.#fixedPixelSize) {
      this.#resizeObserver?.disconnect()
      this.#resizeObserver = null
      window.removeEventListener('resize', this.#onWindowResize)
    }
    this.#fixedPixelSize = { width, height }
    this.#applyResize()
  }

  /** The fixed size set at construction or by `setFixedPixelSize`, if any. */
  get fixedPixelSize(): Readonly<StagePixelSize> | null {
    return this.#fixedPixelSize
  }

  #applyResize = (): void => {
    if (this.#disposed) return
    const { cssW, cssH, dpr } = this.#targetSize()
    if (cssW === 0 || cssH === 0) return
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
   * whole lifetime. A secondary stage (e.g. a pre-warmed demo stage) can park
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

  /**
   * Whether a render frame threw and the stage stopped drawing.
   *
   * A halted stage is otherwise indistinguishable from an idle one: it keeps
   * its canvas, its scene and its `active` flag, and simply stops producing
   * frames. A host that shares one stage across several scenes reads this to
   * tell "nothing to draw" from "this stage is dead", which is the difference
   * between a blank card and a bug.
   */
  get faulted(): boolean {
    return this.#faulted
  }

  /**
   * Whether the stage's pipelines have warmed. Until then {@link render} returns
   * without drawing.
   */
  get ready(): boolean {
    return this.#screenGfx.ready
  }

  /** Resolves once the stage's pipelines have warmed, see {@link ready}. */
  get whenReady(): Promise<void> {
    return this.#screenGfx.whenReady
  }

  /**
   * Whether a layer effect's pipeline is still compiling. Until it finishes,
   * the layer draws without its effects.
   */
  get effectsCompiling(): boolean {
    return this.#screenGfx.effectsCompiling
  }

  /** Resolves once the layer effect pipelines compiling now have finished. */
  whenEffectsCompiled(): Promise<void> {
    return this.#screenGfx.whenEffectsCompiled()
  }

  /**
   * Tear the stage down. Input goes first so pointer capture clears before
   * scene teardown would synthesise cancels through captured nodes, and the
   * device goes last because the canvas listeners live on it.
   */
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
    this.#ambientOcclusion?.dispose()
    this.#ambientOcclusion = null
    // Tear down the WebGL2 device last, canvas listeners live on it.
    this.#device.destroy()
  }
}
