import { Renderer } from './Renderer'
import { Layers } from './Layers'
import { Canvas2DGfx } from './gfx/Canvas2DGfx'
import { GpuGfx } from './gfx/GpuGfx'
import { WebGL2Device } from './gfx/webgl2/WebGL2Device'
import type { Gfx2D } from './gfx/Gfx2D'
import {
  DynamicResolution,
  type DynamicResolutionOptions,
} from './DynamicResolution'

/** Renderer backend mode. Default is `'gpu'`; `?renderer=canvas2d` opts out. */
export type RendererMode = 'canvas2d' | 'gpu'
import { Scene } from '../scene/Scene'
import type { RenderLayer, SceneNode } from '../scene/SceneNode'
import { Camera } from '../camera/Camera'
import type { Rect } from '../math/Rect'
import type { Vec2 } from '../math/Vec2'
import type { Engine } from '../engine/Engine'
import { InputSystem } from '../input/InputSystem'
import type { PointerEvent2D } from '../input/PointerState'
import { createEmitter, type Emitter } from '../events/Emitter'

export interface StageOptions {
  /** World-space rect the camera frames. Default 1000×1000. */
  initialViewport?: Rect
  /** Solid clear color used when `transparent` is false. */
  clearColor?: string
  /** When true, `clear()` uses `clearRect` so the CSS parent shows through. */
  transparent?: boolean
  /**
   * Label in the debug HUD stage selector. Defaults to `Stage {N}`. The
   * primary stage is labelled "Primary" regardless.
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
   * Dynamic-resolution policy. When `enabled`, drops render resolution
   * during camera motion or sustained overload and restores on settle.
   */
  dynamicResolution?: DynamicResolutionOptions
  /**
   * Renderer backend. Default `'canvas2d'`. Under `'gpu'`, acquires a
   * WebGL2 context and routes draws through `GpuGfx`.
   */
  renderer?: RendererMode
  /**
   * MSAA sample count under GPU. `1` disables, `>1` allocates a multisample
   * renderbuffer. Default 4, clamped to driver `MAX_SAMPLES`. No effect
   * under Canvas mode.
   */
  msaaSamples?: number
}

/**
 * Per-stage pointer events. Fires only on interactive stages. `pointerMove`
 * is high-frequency, do NOT bind Svelte stores to it. Use `$effect`
 * listeners instead.
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

const DEFAULT_VIEWPORT: Rect = { x: 0, y: 0, width: 1000, height: 1000 }

/** Hard floor for `setRenderScale`, a safety clamp below any policy value. */
const MIN_RENDER_SCALE = 0.1

/**
 * World-unit slack on viewport cull, on top of stroke half-width. Covers AA
 * edges and sub-pixel drift so nodes don't pop early at the boundary.
 */
const CULL_AA_PAD_WORLD = 2

/**
 * A render surface (canvas + `Renderer` + `Scene` + `Camera` + `Layers`).
 * All stages share the engine's `Ticker` and `Animator` for drift-free
 * synced tweens.
 */
export class Stage {
  readonly renderer: Renderer
  readonly scene: Scene
  readonly camera: Camera
  readonly layers: Layers
  /** Owning canvas. Public so the debug controller / demos can reference it. */
  readonly canvas: HTMLCanvasElement
  /** Optional label shown in the debug HUD's stage selector. */
  readonly name: string | undefined
  /** Always constructed. Only fires on interactive stages. */
  readonly events: Emitter<StagePointerEvents> =
    createEmitter<StagePointerEvents>()
  /** `null` when the stage is display-only. */
  readonly input: InputSystem | null

  private readonly onResize?: (info: StageResizeInfo) => void
  private resizeObserver: ResizeObserver | null = null
  private disposed = false

  /**
   * On-canvas rendering surface. `GpuGfx` (WebGL2) by default, `Canvas2DGfx`
   * under `?renderer=canvas2d`. Both implement `Gfx2D` so Stage is
   * backend-branch-free.
   */
  private readonly screenGfx: Canvas2DGfx | GpuGfx
  /** WebGL2 device (only when `screenGfx instanceof GpuGfx`). */
  private readonly device: WebGL2Device | null
  /** Facade wrapping the offscreen static-bake ctx; created on first bake. */
  private bakeGfx: Canvas2DGfx | null = null

  // Static-cache bookkeeping, per-stage so each canvas gets its own bake.
  private prevCameraFrameNum = -1
  private bakedAtCameraFrameNum = -1

  // Dynamic-resolution knob. Backing-store density is
  // `devicePixelRatio × _renderScale`; the CSS element stays at display size,
  // so a scale < 1 renders fewer device pixels and the browser upscales.
  // Driven by `setRenderScale` (see DynamicResolution).
  private _renderScale = 1

  /** Dynamic-resolution policy driving `_renderScale`; null when disabled. */
  private readonly dynRes: DynamicResolution | null

  // Scratch for the per-layer viewport-cull bounds, reused each frame.
  private readonly cullTL: Vec2 = { x: 0, y: 0 }
  private readonly cullBR: Vec2 = { x: 0, y: 0 }

  constructor(
    canvas: HTMLCanvasElement,
    engine: Engine,
    opts: StageOptions = {},
  ) {
    this.canvas = canvas
    this.name = opts.name
    this.onResize = opts.onResize
    this.renderer = new Renderer({
      canvas,
      clearColor: opts.clearColor,
      transparent: opts.transparent,
    })
    const mode: RendererMode = opts.renderer ?? 'canvas2d'
    if (mode === 'gpu') {
      // Kick the initial canvas size BEFORE the GL context is acquired so the
      // default framebuffer starts at the right pixel size.
      const rect = canvas.getBoundingClientRect()
      const initialCssW = rect.width || canvas.clientWidth || 1
      const initialCssH = rect.height || canvas.clientHeight || 1
      const initialDpr = window.devicePixelRatio || 1
      this.renderer.resize(initialCssW, initialCssH, initialDpr)
      this.device = new WebGL2Device(canvas)
      this.screenGfx = new GpuGfx(canvas, this.device, {
        samples: opts.msaaSamples ?? 4,
      })
      this.screenGfx.setInternalSize(
        this.renderer.pixelSize.w,
        this.renderer.pixelSize.h,
      )
    } else {
      this.device = null
      this.screenGfx = new Canvas2DGfx(canvas, {
        transparent: opts.transparent ?? false,
      })
    }
    this.scene = new Scene()
    this.scene.engine = engine
    this.camera = new Camera(opts.initialViewport ?? DEFAULT_VIEWPORT)
    this.camera.engine = engine
    this.layers = new Layers()
    // DynamicResolution is a Canvas-era optimization (drop rasterization
    // pixel count when the CPU can't keep up). Under GPU the 4K fill rate
    // is trivial and the CPU-rasterize path is gone. DynRes only adds
    // post-motion blur without helping perf. Force-disabled under GPU
    // regardless of config.
    const dynResEnabled =
      opts.dynamicResolution?.enabled === true && mode !== 'gpu'
    this.dynRes =
      dynResEnabled && opts.dynamicResolution
        ? new DynamicResolution(opts.dynamicResolution)
        : null

    // Kiosk hygiene, touch/selection suppression on every canvas. Applied
    // here so Svelte-mounted secondary canvases inherit it.
    const style = canvas.style
    style.touchAction = 'none'
    style.userSelect = 'none'
    style.webkitUserSelect = 'none'
    style.setProperty('-webkit-touch-callout', 'none')
    style.outline = 'none'

    this.applyResize()
    this.resizeObserver = new ResizeObserver(() => this.applyResize())
    this.resizeObserver.observe(canvas)
    window.addEventListener('resize', this.onWindowResize)

    // Input attaches last, needs renderer + camera in place. Debug
    // controller may still be null (set on Engine after primaryStage).
    this.input = opts.interactive ? new InputSystem(this, engine) : null
  }

  /**
   * Recompute local + world transforms across the scene. Skips clean
   * subtrees (both `_worldDirty` false AND parent world unchanged). See
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
      this.propagateTransform(children[i], rw, rootDirty)
    }
  }

  private propagateTransform(
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
      this.propagateTransform(children[i], w, nodeDirty)
    }
  }

  /**
   * Render this stage. Uses `camera` (defaults to `this.camera`) for projection
   * , the primary Engine passes its `activeCamera` so the debug camera can
   * drive the primary stage's view when toggled on. The 3-pass layer walk +
   * adaptive static-cache logic is unchanged from the single-canvas Engine
   * implementation; it now runs per stage.
   */
  render(dt: number, camera: Camera = this.camera): void {
    const { renderer } = this
    // Sync the camera's pixel size to this stage's canvas.
    camera.setPixelSize(renderer.cssSize.w, renderer.cssSize.h)

    const t = camera.getScreenTransform()
    if (t.scale <= 0) return

    const currentFN = camera.frameNum
    const camMovedSincePrevFrame = currentFN !== this.prevCameraFrameNum
    this.prevCameraFrameNum = currentFN

    // Dynamic resolution: choose this frame's render scale BEFORE reading the
    // DPR below. `setRenderScale` may resize the backing store and invalidate
    // the static bake, so it has to happen ahead of the draw.
    if (this.dynRes) {
      const target = this.dynRes.update(
        performance.now(),
        camMovedSincePrevFrame,
      )
      if (target !== this._renderScale) this.setRenderScale(target)
    }

    // Read DPR after any resolution change above (renderer.dpr may have moved).
    const dpr = renderer.dpr
    const dprScale = dpr * t.scale
    const vE = dpr * t.offsetX
    const vF = dpr * t.offsetY

    const cacheHit =
      !this.scene.staticInvalid && this.bakedAtCameraFrameNum === currentFN

    // Frame-phase perf marks, same `engine.perfMarks` opt-in as the per-node
    // marks in `drawLayer`, so `?debug=perf` brackets each render phase
    // (clear / static / above-static / dynamic) as a `performance.measure`.
    const marks = this.scene.engine?.perfMarks ?? false

    const screen = this.screenGfx

    this.phaseBegin(marks, 'clear')
    screen.beginFrame({
      clearColor: renderer.clearColor,
      transparent: renderer.transparent,
      pixelW: renderer.pixelSize.w,
      pixelH: renderer.pixelSize.h,
    })
    this.phaseEnd(marks, 'clear')

    const isGpu = screen instanceof GpuGfx
    if (isGpu) {
      // Under GPU, map Path2Ds are tessellated at asset load, so rendering
      // the static layer live every frame is one colored-tri batch (~5K
      // tris). Sharper than the bake + reproject and avoids CLAMP_TO_EDGE
      // artifacts when the viewport strays outside the bake's coverage.
      this.phaseBegin(marks, 'static-render')
      this.drawLayer('static', screen, camera, dprScale, vE, vF, dt)
      this.phaseEnd(marks, 'static-render')
    } else if (cacheHit) {
      // Canvas: cached ImageBitmap blit, the fast path.
      this.phaseBegin(marks, 'static-blit')
      this.blitStaticCache()
      this.phaseEnd(marks, 'static-blit')
    } else if (camMovedSincePrevFrame) {
      // Canvas motion: fresh rasterize (defer the bake so it happens on
      // settle when the frame budget can absorb it).
      this.phaseBegin(marks, 'static-fresh')
      this.drawLayer('static', screen, camera, dprScale, vE, vF, dt)
      this.phaseEnd(marks, 'static-fresh')
      this.bakedAtCameraFrameNum = -1
    } else {
      this.phaseBegin(marks, 'static-bake')
      const bakeCtx = this.layers.ensureSize(
        renderer.pixelSize.w,
        renderer.pixelSize.h,
      )
      const bakeGfx = this.bakeGfx ?? (this.bakeGfx = new Canvas2DGfx(bakeCtx))
      bakeGfx.setContext(bakeCtx)
      this.layers.clearBake()
      this.drawLayer('static', bakeGfx, camera, dprScale, vE, vF, dt)
      this.layers.recordBake()
      this.bakedAtCameraFrameNum = currentFN
      this.scene.markStaticClean()
      this.blitStaticCache()
      this.phaseEnd(marks, 'static-bake')
    }
    this.flushIfGpu(screen)

    this.phaseBegin(marks, 'above-static')
    this.drawLayer('above-static', screen, camera, dprScale, vE, vF, dt)
    this.phaseEnd(marks, 'above-static')
    this.flushIfGpu(screen)

    this.phaseBegin(marks, 'dynamic')
    this.drawLayer('dynamic', screen, camera, dprScale, vE, vF, dt)
    this.phaseEnd(marks, 'dynamic')
    this.flushIfGpu(screen)

    // Debug overlays draw INSIDE the frame so they composite on top of the
    // dynamic layer through the same gfx pipeline.
    const debug = this.scene.engine?.debug
    const activeDebugStage = debug?.activeStage ?? this
    if (debug && activeDebugStage === this) {
      this.phaseBegin(marks, 'debug-overlay')
      debug.drawOverlay(this, camera, screen)
      this.phaseEnd(marks, 'debug-overlay')
    }
    if (debug && this.input) {
      debug.drawInputOverlay(this, screen)
    }
    this.flushIfGpu(screen)

    screen.endFrame()
  }

  /** Canvas-only. GPU renders the static layer live each frame instead. */
  private blitStaticCache(): void {
    const screen = this.screenGfx
    if (!(screen instanceof Canvas2DGfx)) return
    this.layers.blit(screen.ctx)
  }

  private flushIfGpu(screen: Canvas2DGfx | GpuGfx): void {
    if (screen instanceof GpuGfx) screen.flush()
  }

  /**
   * The 2D context under Canvas mode. `null` under GPU. Escape hatch for
   * consumers that need raw `CanvasRenderingContext2D` access.
   */
  get canvas2dCtx(): CanvasRenderingContext2D | null {
    return this.screenGfx instanceof Canvas2DGfx ? this.screenGfx.ctx : null
  }

  /**
   * Per-frame GPU pipeline stats, or `null` under Canvas mode. Read by the
   * debug HUD.
   */
  get gpuStats(): {
    drawCalls: number
    programSwitches: number
    textureBinds: number
    blendSwitches: number
    overflowWarns: number
    sdfInstances: number
    strokeInstances: number
    msaaSamples: number
  } | null {
    return this.screenGfx instanceof GpuGfx ? this.screenGfx.stats : null
  }

  /**
   * Live-switch MSAA sample count on the GPU render target. No-op under Canvas
   * mode. Requested value is clamped to the driver's `MAX_SAMPLES` inside the
   * device.
   */
  setMsaaSamples(samples: number): void {
    if (this.screenGfx instanceof GpuGfx) this.screenGfx.setSamples(samples)
  }

  /** Effective (post-clamp) MSAA sample count, or `null` under Canvas. */
  getMsaaSamples(): number | null {
    return this.screenGfx instanceof GpuGfx ? this.screenGfx.getSamples() : null
  }

  /**
   * Toggle a GPU-only debug render mode. No-op under Canvas mode. See
   * `DebugRenderMode` for the modes and what they visualise.
   */
  setDebugRenderMode(mode: import('./gfx/GpuGfx').DebugRenderMode): void {
    if (this.screenGfx instanceof GpuGfx)
      this.screenGfx.setDebugRenderMode(mode)
  }

  /** Current GPU debug render mode, or `null` under Canvas. */
  getDebugRenderMode(): import('./gfx/GpuGfx').DebugRenderMode | null {
    return this.screenGfx instanceof GpuGfx
      ? this.screenGfx.getDebugRenderMode()
      : null
  }

  /** Open a render-phase perf span. No-op unless `engine.perfMarks` is on. */
  private phaseBegin(marks: boolean, name: string): void {
    if (marks) performance.mark(`phase-${name}:start`)
  }

  /**
   * Close a phase span from `phaseBegin`, emits a `performance.measure`
   * surfaced by the Firefox Profiler. No-op unless `engine.perfMarks` is on.
   */
  private phaseEnd(marks: boolean, name: string): void {
    if (!marks) return
    performance.mark(`phase-${name}:end`)
    performance.measure(name, `phase-${name}:start`, `phase-${name}:end`)
  }

  private drawLayer(
    layer: RenderLayer,
    gfx: Gfx2D,
    camera: Camera,
    scaleDpr: number,
    offX: number,
    offY: number,
    dt: number,
  ): void {
    const marks = this.scene.engine?.perfMarks ?? false
    // Cull rect from the canvas corners (not the camera viewport) so it
    // includes letterbox margins, otherwise content still on screen in the
    // uncovered axis clips.
    const cssW = this.renderer.cssSize.w
    const cssH = this.renderer.cssSize.h
    camera.screenToWorld(0, 0, this.cullTL)
    camera.screenToWorld(cssW, cssH, this.cullBR)
    const visLeft = Math.min(this.cullTL.x, this.cullBR.x)
    const visRight = Math.max(this.cullTL.x, this.cullBR.x)
    const visTop = Math.min(this.cullTL.y, this.cullBR.y)
    const visBottom = Math.max(this.cullTL.y, this.cullBR.y)
    const strokeScale = camera.strokeSpaceScale()

    const layerNodes = this.scene.getLayerNodes(layer)
    for (let i = 0; i < layerNodes.length; i++) {
      const node = layerNodes[i]
      if (!node.visible) continue
      if (!node.draw) continue
      // Skip nodes whose bounds are fully outside the visible rect. Only nodes
      // that declare `debugBounds` can be culled; the rest always draw.
      if (
        node.debugBounds &&
        this.isOutsideView(
          node,
          strokeScale,
          visLeft,
          visRight,
          visTop,
          visBottom,
        )
      ) {
        continue
      }
      const w = node.transform.world
      // final = (DPR × camera-uniform) × node.world
      // camera has zero skew and uniform scale, so we hand-compose in 2D:
      const fA = scaleDpr * w.a
      const fB = scaleDpr * w.b
      const fC = scaleDpr * w.c
      const fD = scaleDpr * w.d
      const fE = scaleDpr * w.e + offX
      const fF = scaleDpr * w.f + offY
      gfx.setBaseTransform(fA, fB, fC, fD, fE, fF)
      gfx.setAlpha(node.transform.alpha)
      const id = marks ? node.id : ''
      const startMark = marks ? `draw-${id}:start` : ''
      if (marks) performance.mark(startMark)
      node.draw(gfx, camera, dt)
      if (marks) {
        const endMark = `draw-${id}:end`
        performance.mark(endMark)
        performance.measure(`draw ${id}`, startMark, endMark)
      }
    }
    gfx.setAlpha(1)
  }

  /**
   * True when `node`'s world-space AABB lies fully outside the visible rect
   * (with a stroke + AA margin). The AABB is the node's local `debugBounds`
   * pushed through its world matrix (all four corners, so rotated nodes are
   * handled). The margin adds the node's own stroke half-width. CSS-px strokes
   * convert to world via `strokeScale`, so a state whose FILL is just
   * off-screen doesn't get its visible stroke clipped.
   */
  private isOutsideView(
    node: SceneNode,
    strokeScale: number,
    visLeft: number,
    visRight: number,
    visTop: number,
    visBottom: number,
  ): boolean {
    const b = node.debugBounds!
    const w = node.transform.world
    const x0 = b.x
    const y0 = b.y
    const x1 = b.x + b.width
    const y1 = b.y + b.height
    // Four local corners → world.
    const wx0 = w.a * x0 + w.c * y0 + w.e
    const wy0 = w.b * x0 + w.d * y0 + w.f
    const wx1 = w.a * x1 + w.c * y0 + w.e
    const wy1 = w.b * x1 + w.d * y0 + w.f
    const wx2 = w.a * x1 + w.c * y1 + w.e
    const wy2 = w.b * x1 + w.d * y1 + w.f
    const wx3 = w.a * x0 + w.c * y1 + w.e
    const wy3 = w.b * x0 + w.d * y1 + w.f
    const minX = Math.min(wx0, wx1, wx2, wx3)
    const maxX = Math.max(wx0, wx1, wx2, wx3)
    const minY = Math.min(wy0, wy1, wy2, wy3)
    const maxY = Math.max(wy0, wy1, wy2, wy3)

    // Stroke half-width in world units (0 for non-stroked nodes). Screen-space
    // strokes (the default) scale by `strokeScale`; world-space strokes are
    // already in world units.
    const strokeNode = node as { lineWidth?: number; strokeSpace?: string }
    const lw = strokeNode.lineWidth ?? 0
    const worldStrokeHalf =
      lw > 0
        ? (strokeNode.strokeSpace === 'world' ? lw : lw * strokeScale) * 0.5
        : 0
    const m = worldStrokeHalf + CULL_AA_PAD_WORLD

    return (
      maxX < visLeft - m ||
      minX > visRight + m ||
      maxY < visTop - m ||
      minY > visBottom + m
    )
  }

  /** Re-acquire the rendering context after a `contextrestored` event. */
  reacquireContext(): void {
    this.screenGfx.reacquireContext()
    this.screenGfx.rebuildResources()
    // The offscreen bake context is gone too, drop the facade so the next
    // bake recreates it against a fresh offscreen.
    this.bakeGfx = null
    // Static bake is gone with the old context, mark for rebake.
    this.scene.invalidateStatic()
    this.bakedAtCameraFrameNum = -1
  }

  private applyResize = (): void => {
    if (this.disposed) return
    const rect = this.canvas.getBoundingClientRect()
    const cssW = rect.width
    const cssH = rect.height
    if (cssW === 0 || cssH === 0) return
    // Fold the render scale into the effective DPR so a real CSS/DPR resize
    // preserves whatever dynamic-resolution scale is currently applied.
    const dpr = window.devicePixelRatio * this._renderScale
    if (
      cssW === this.renderer.cssSize.w &&
      cssH === this.renderer.cssSize.h &&
      dpr === this.renderer.dpr
    ) {
      return
    }
    this.renderer.resize(cssW, cssH, dpr)
    this.screenGfx.setInternalSize(
      this.renderer.pixelSize.w,
      this.renderer.pixelSize.h,
    )
    this.camera.setPixelSize(cssW, cssH)
    this.scene.invalidateStatic()
    // Backing store changed size, the offscreen bake is the wrong resolution.
    this.bakedAtCameraFrameNum = -1
    this.onResize?.({
      cssSize: { ...this.renderer.cssSize },
      pixelSize: { ...this.renderer.pixelSize },
      dpr,
    })
  }

  private onWindowResize = (): void => this.applyResize()

  /** Current dynamic-resolution scale in `(0, 1]`. Surfaced to the debug HUD. */
  get renderScale(): number {
    return this._renderScale
  }

  /**
   * Set the dynamic-resolution scale and resize the backing store to
   * `devicePixelRatio × scale`. Does NOT fire `onResize`, only pixel
   * density changes. Invalidates the static bake so the next blit sees a
   * correctly-sized bitmap.
   */
  setRenderScale(scale: number): void {
    const clamped = Math.max(MIN_RENDER_SCALE, Math.min(1, scale))
    if (clamped === this._renderScale) return
    this._renderScale = clamped
    if (this.disposed) return
    const cssW = this.renderer.cssSize.w
    const cssH = this.renderer.cssSize.h
    if (cssW === 0 || cssH === 0) return
    const dpr = window.devicePixelRatio * clamped
    if (dpr === this.renderer.dpr) return
    this.renderer.resize(cssW, cssH, dpr)
    this.screenGfx.setInternalSize(
      this.renderer.pixelSize.w,
      this.renderer.pixelSize.h,
    )
    // Camera pixel size is CSS-space and unchanged, no `setPixelSize` needed.
    this.scene.invalidateStatic()
    this.bakedAtCameraFrameNum = -1
  }

  dispose(): void {
    if (this.disposed) return
    this.disposed = true
    // Input FIRST so pointer capture clears before scene teardown would
    // synthesise cancels through captured nodes.
    this.input?.destroy()
    this.resizeObserver?.disconnect()
    this.resizeObserver = null
    window.removeEventListener('resize', this.onWindowResize)
    this.scene.root.destroy()
    this.layers.dispose()
    // Tear down the WebGL2 device last, canvas listeners live on it.
    this.device?.destroy()
  }
}
