import { createTicker, type Ticker } from './Ticker'
import type { Renderer } from '../render/Renderer'
import { createEmitter, type Emitter } from '../events/Emitter'
import type { EngineEvents } from '../events/EngineEvents'
import type { Scene } from '../scene/Scene'
import type { SceneNode } from '../scene/SceneNode'
import { walkTree } from '../scene/traverse'
import type { Camera } from '../camera/Camera'
import type { Rect } from '../math/Rect'
import type { DebugController } from '../debug/DebugController'
import { InputSystem } from '../input/InputSystem'
import { Animator, type TweenOptions } from '../anim/Animator'
import { combineAbortSignals } from '../anim/abortSignal'
import type { Transform2D } from '../math/Transform2D'
import type { Layers } from '../render/Layers'
import {
  Stage,
  type RendererMode,
  type StageOptions,
  type StagePointerEvents,
} from '../render/Stage'
import {
  DEFAULT_DYNAMIC_RESOLUTION,
  type DynamicResolutionOptions,
} from '../render/DynamicResolution'

export interface EngineOptions {
  canvas: HTMLCanvasElement
  clearColor?: string
  /**
   * If true the canvas is composited transparently, the frame clear uses
   * `clearRect` so whatever CSS background lives behind the canvas shows
   * through. `clearColor` is ignored in this mode.
   */
  transparent?: boolean
  fixedStepHz?: number
  maxDt?: number
  /** Initial camera viewport in world coords. Default 1920×1080. */
  initialViewport?: Rect
  /**
   * Dynamic-resolution policy for the PRIMARY stage. Presence of this key
   * enables it (with `DEFAULT_DYNAMIC_RESOLUTION` for anything unspecified);
   * pass `{ enabled: false }` to keep it off explicitly. Secondary stages
   * (attached via `attachStage`) never get it. See `DynamicResolution`.
   */
  dynamicResolution?: Partial<DynamicResolutionOptions>
  /**
   * Renderer backend for the primary stage, and, by inheritance, the default
   * for any secondary stages attached later. Default `'canvas2d'`. Set to
   * `'gpu'` to route drawing through the WebGL2 backend (Phase 1 renders grid
   *
   * - Particles + static-as-quad; other primitives no-op until Phase 2).
   *   Typically set via `EngineHost`'s `?renderer=gpu` URL flag rather than
   *   passed explicitly.
   */
  renderer?: RendererMode
  /**
   * MSAA sample count for the GPU render target. `0`/`1` disables MSAA; `> 1`
   * allocates a multisample color renderbuffer resolved on present. Default 4
   * under GPU. Threaded to the primary stage and inherited by secondary stages
   * via `attachStage` unless overridden. No effect under Canvas mode.
   */
  msaaSamples?: number
}

// Landscape 16:9 by default. The kiosk is 3840×2160 and every dev browser
// is landscape too; specific games (e.g. the Germany-map one) override.
const DEFAULT_VIEWPORT: Rect = { x: 0, y: 0, width: 1920, height: 1080 }

/**
 * The core engine, composes ticker, primary stage, input, animation, and the
 * outgoing event bus. One `Ticker` and one `Animator` drive the primary stage
 * plus any secondary stages attached via `attachStage(canvas, opts)`.
 *
 * `debug` is `null` in production. When constructed by `EngineHost` with
 * `?debug` in the URL, it points at a `DebugController` and the primary stage's
 * render pass routes through the debug camera + overlay accordingly. Secondary
 * stages never receive the debug overlay.
 */
export class Engine {
  readonly ticker: Ticker
  readonly events: Emitter<EngineEvents>
  readonly canvas: HTMLCanvasElement
  /**
   * The primary render surface. `engine.{renderer,scene,camera,layers}` are
   * getters onto this.
   */
  readonly primaryStage: Stage
  readonly animation: Animator
  /** Renderer backend selected at construction, secondary stages inherit. */
  readonly rendererMode: RendererMode
  /** MSAA sample count inherited by secondary stages under GPU. */
  readonly msaaSamples: number
  /**
   * Wall-clock **CPU work** spent inside the most recent `frame()`, in SECONDS
   * to match the ticker's `dt` units so `FrameStats` can consume both
   * interchangeably. This is NOT the vsync-locked rAF interval: measured from
   * `performance.now()` at frame entry to `.now()` at the end of the render
   * walk, so idle waits between frames (which the browser inserts to align with
   * the display refresh) don't inflate the reading. Under 60 Hz vsync, a
   * well-behaved frame reads ~1-10 ms here even though the rAF interval is
   * always ~16.67 ms.
   */
  lastFrameWorkSec = 0

  debug: DebugController | null = null
  /**
   * When true, per-node `onUpdate` and `draw` calls are wrapped in
   * `performance.mark()` / `performance.measure()`. DevTools Performance → User
   * Timing lane then shows a per-frame flame chart of every node's cost. Off by
   * default; opt in via `?debug=perf` URL flag or by setting `engine.perfMarks
   * = true` at runtime. When off, the per-node overhead is a single boolean
   * check.
   */
  perfMarks = false

  private readonly _stages = new Set<Stage>()
  private readonly _attachedCanvases = new WeakSet<HTMLCanvasElement>()
  private readonly disposeCallbacks: Array<() => void> = []
  private readonly beforeFrameHandlers = new Set<(dt: number) => void>()
  private disposed = false
  private hasEmittedReady = false
  private _paused = false

  constructor(opts: EngineOptions) {
    this.canvas = opts.canvas
    this.events = createEmitter<EngineEvents>()
    this.ticker = createTicker({
      fixedStepHz: opts.fixedStepHz,
      maxDt: opts.maxDt,
    })
    this.rendererMode = opts.renderer ?? 'canvas2d'
    this.msaaSamples = opts.msaaSamples ?? 4
    // Primary stage owns the renderer / scene / camera / layers / input.
    // `interactive: true` attaches an InputSystem to its canvas, the primary
    // is always interactive.
    this.primaryStage = new Stage(opts.canvas, this, {
      initialViewport: opts.initialViewport ?? DEFAULT_VIEWPORT,
      clearColor: opts.clearColor,
      transparent: opts.transparent ?? false,
      interactive: true,
      renderer: this.rendererMode,
      msaaSamples: this.msaaSamples,
      // Presence of `dynamicResolution` opts the primary in (enabled by
      // default); a caller can still pass `enabled: false` to override.
      dynamicResolution: opts.dynamicResolution
        ? {
            ...DEFAULT_DYNAMIC_RESOLUTION,
            enabled: true,
            ...opts.dynamicResolution,
          }
        : undefined,
      onResize: (info) => {
        // Only the primary stage's resize emits on the engine event bus.        // secondary stages resize silently.
        this.events.emit('resize', {
          pixel: info.pixelSize,
          css: info.cssSize,
          dpr: info.dpr,
        })
      },
    })
    this._attachedCanvases.add(opts.canvas)
    this.animation = new Animator()

    // Forward primary-stage pointer events onto `engine.events` for
    // backwards compat. Secondary stages' pointer events stay isolated on
    // their own `stage.events`, so game code that listens at the engine
    // level can't accidentally process tutorial-canvas taps as live-game
    // input.
    const forwardKeys: (keyof StagePointerEvents)[] = [
      'pointerDown',
      'pointerMove',
      'pointerUp',
      'pointerCancel',
    ]
    for (const key of forwardKeys) {
      const off = this.primaryStage.events.on(key, (e) =>
        this.events.emit(key, e),
      )
      this.disposeCallbacks.push(off)
    }

    this.ticker.onFrame((dt) => this.frame(dt))
    this.ticker.onFixedStep((fdt) => this.fixedStep(fdt))
    // Kiosk hygiene now lives on Stage, every canvas Stage owns gets it,
    // including secondaries mounted from Svelte components.
  }

  /** Shortcut for the primary stage's `InputSystem`. Always defined. */
  get input(): InputSystem {
    // Non-null: primaryStage is always constructed with `interactive: true`.
    return this.primaryStage.input!
  }

  // Backwards-compat getters, external code keeps using `engine.renderer`,
  // `engine.scene`, `engine.camera`, `engine.layers` unchanged.
  get renderer(): Renderer {
    return this.primaryStage.renderer
  }
  get scene(): Scene {
    return this.primaryStage.scene
  }
  get camera(): Camera {
    return this.primaryStage.camera
  }
  get layers(): Layers {
    return this.primaryStage.layers
  }

  /** The camera currently driving rendering + input world-coord conversion. */
  get activeCamera(): Camera {
    return this.debug?.cameraActive ? this.debug.camera : this.camera
  }

  /**
   * Soft freeze, ticker keeps running (so debug tools and camera panning stay
   * responsive), but game state advances stop: no `animation.tick`, no
   * `onUpdate`, no fixed-step. Distinct from `stop()` (which cancels rAF) and
   * from `EngineHost.pause()` (which is a full stop for
   * overlay-covers-canvas).
   */
  get paused(): boolean {
    return this._paused
  }
  setPaused(v: boolean): void {
    this._paused = v
  }

  /** Read-only view of currently-attached secondary stages. */
  get stages(): ReadonlySet<Stage> {
    return this._stages
  }

  /**
   * Attach a secondary `Stage` to `canvas`. Its scene, camera, and static-layer
   * cache are independent from the primary stage's, but it shares the ticker
   * and animator, tweens on its nodes stay in sync with the primary.
   *
   * Throws if `canvas` is already attached (including the primary canvas).
   */
  attachStage(canvas: HTMLCanvasElement, opts: StageOptions = {}): Stage {
    if (this.disposed) {
      throw new Error('stargazer: attachStage after engine.destroy()')
    }
    if (this._attachedCanvases.has(canvas)) {
      throw new Error(
        'stargazer: attachStage called with a canvas that is already attached',
      )
    }
    // Secondary stages default to transparent, the parent HTML card
    // typically owns the background (rounded corners, gradient, etc.).
    const stage = new Stage(canvas, this, {
      initialViewport: opts.initialViewport,
      clearColor: opts.clearColor,
      transparent: opts.transparent ?? true,
      // `interactive` and `name` are forwarded so callers that pass them.      // demo-stages, TutorialSession, actually get an InputSystem attached
      // and a labelled entry in the debug HUD's stage selector.
      interactive: opts.interactive,
      name: opts.name,
      // Secondary stages inherit the primary's renderer backend by default.      // callers can override per stage (e.g. tests that want to compare
      // Canvas + GPU side by side).
      renderer: opts.renderer ?? this.rendererMode,
      msaaSamples: opts.msaaSamples ?? this.msaaSamples,
      // `onResize` gives the caller (TutorialSession) a hook to reshape
      // the world viewport when the canvas CSS size changes.
      onResize: opts.onResize,
    })
    this._stages.add(stage)
    this._attachedCanvases.add(canvas)
    return stage
  }

  /**
   * Detach and dispose a secondary stage. Cascades AbortErrors through its
   * scene tree, disconnects the ResizeObserver, releases the offscreen layer
   * canvas, and frees the one-stage-per-canvas slot.
   */
  detachStage(stage: Stage): void {
    if (!this._stages.delete(stage)) return
    // `WeakSet.delete` isn't on all TS lib targets, cast to any. The GC will
    // reclaim the entry when the canvas element itself is collected either
    // way; explicit delete is only for the reattach-same-canvas case.
    ;(
      this._attachedCanvases as unknown as {
        delete(v: HTMLCanvasElement): boolean
      }
    ).delete(stage.canvas)
    // Let the debug controller flip its active-stage selection back to
    // primary if this was the inspected stage.
    this.debug?.onStageDetached(stage)
    stage.dispose()
  }

  /**
   * Register a callback that runs at the top of every frame, BEFORE
   * `InputSystem.beforeFrame()` reprojects pointer world coords. Camera- moving
   * subsystems (debug camera step, animation tweens on the camera) hook here so
   * pointer state stays glued to the finger during motion.
   */
  onBeforeFrame(cb: (dt: number) => void): () => void {
    this.beforeFrameHandlers.add(cb)
    return () => {
      this.beforeFrameHandlers.delete(cb)
    }
  }

  start(): void {
    if (this.disposed) return
    this.ticker.start()
    if (!this.hasEmittedReady) {
      this.hasEmittedReady = true
      this.events.emit('ready', {
        pixelSize: { ...this.renderer.pixelSize },
      })
    }
  }

  stop(): void {
    if (this.disposed) return
    this.ticker.stop()
  }

  destroy(): void {
    if (this.disposed) return
    this.disposed = true
    this.stop()
    // Reject every outstanding tween/wait with AbortError before we start
    // tearing scenes apart, otherwise dangling Promises hang forever.
    this.animation.cancelAll()
    this.debug?.destroy()
    this.debug = null
    // Dispose secondaries first so cascade order is deterministic. Each
    // Stage.dispose() tears down its own InputSystem (if any).
    for (const stage of this._stages) stage.dispose()
    this._stages.clear()
    this.primaryStage.dispose()
    for (const fn of this.disposeCallbacks) fn()
    this.disposeCallbacks.length = 0
    this.beforeFrameHandlers.clear()
    this.events.emit('destroyed', undefined)
  }

  private frame(dt: number): void {
    // Measure actual CPU work per frame (not the vsync-locked rAF
    // interval). Stashed in `lastFrameWorkSec`; consumed by
    // DebugController.frameStats so the HUD shows real work time
    // rather than "always ~16.67 ms" under 60 Hz vsync. See the field
    // doc for why this matters.
    const workT0 = performance.now()
    // 1. Before-frame hooks, subsystems that MUTATE the active camera
    //    (debug camera step, camera tweens) run here so step 2 sees the
    //    up-to-date camera. Runs even when paused so the debug camera
    //    stays interactive during a debug freeze.
    for (const cb of this.beforeFrameHandlers) cb(dt)

    // 2. Input: reproject pointer world coords, emit synthetic moves for
    //    any pointer whose world drifted under a still finger this frame.
    //    Skipped while paused, a debug freeze should not fire game-side
    //    pointerMove callbacks either. Every interactive stage runs its own
    //    beforeFrame so secondaries stay glued to fingers under camera pan.
    if (!this._paused) {
      this.primaryStage.input?.beforeFrame()
      for (const s of this._stages) s.input?.beforeFrame()
    }

    if (!this._paused) {
      // 3. Advance active tweens and waits FIRST so game code in the update
      //    pass reads the freshest transform values.
      this.animation.tick(dt)

      // 4. Update pass, walk every stage's scene tree. Behaviour hooks may
      //    read pointer state (primary input).
      this.walkUpdate(this.primaryStage, dt)
      for (const stage of this._stages) this.walkUpdate(stage, dt)
    }

    // 5. Transform propagation, every stage, always. Idempotent when nothing
    //    changed; needed even while paused so debug-camera pans reflect in
    //    the primary render output.
    this.primaryStage.updateTransforms()
    for (const stage of this._stages) stage.updateTransforms()

    // 6. Render every stage. Each stage renders through either its own game
    //    camera or, for whichever stage the debug HUD has selected AND
    //    when the debug camera is toggled on, the debug camera. Debug
    //    overlays (grid / outlines / game-camera pip / pointer markers)
    //    are drawn INSIDE `stage.render()`. Phase 4 moved them there so
    //    they composite via the same `Gfx2D` pipeline as game content
    //    (particularly important under GPU where `endFrame()` blits the
    //    FBO to the canvas, so an "after render()" pass would be too
    //    late to be visible).
    const debug = this.debug
    this.primaryStage.render(
      dt,
      debug
        ? debug.activeCameraFor(this.primaryStage)
        : this.primaryStage.camera,
    )
    for (const stage of this._stages) {
      stage.render(dt, debug ? debug.activeCameraFor(stage) : stage.camera)
    }

    // Stash the actual CPU work time BEFORE emitting `frame` so any
    // listener (DebugController.frameStats.push) reads a current value.
    this.lastFrameWorkSec = (performance.now() - workT0) / 1000

    // 7. Emit frame.
    this.events.emit('frame', {
      time: this.ticker.time,
      dt,
      frameNum: this.ticker.frameNum,
    })
  }

  private walkUpdate(stage: Stage, dt: number): void {
    const marks = this.perfMarks
    walkTree(stage.scene.root, (node) => {
      // Skip the per-node body AND its perf marks when this node has no
      // update work. The tree walk itself still visits, its cost is a
      // function call; the body / performance.measure are what actually
      // hurt. See SceneNode._hasUpdateWork.
      if (!node._hasUpdateWork) return
      const id = marks ? node.id : ''
      const startMark = marks ? `update-${id}:start` : ''
      if (marks) performance.mark(startMark)
      node.onUpdate?.(dt)
      const behaviours = node.behaviours
      for (let i = 0; i < behaviours.length; i++) {
        behaviours[i].onUpdate?.(dt)
      }
      if (marks) {
        const endMark = `update-${id}:end`
        performance.mark(endMark)
        performance.measure(`update ${id}`, startMark, endMark)
      }
    })
  }

  /**
   * Tween any number of numeric properties on `target` to their `to` values.
   * See `Animator.tween` for the underlying implementation.
   */
  tween<T extends object>(
    target: T,
    to: Partial<T>,
    opts: TweenOptions,
  ): Promise<void> {
    return this.animation.tween(target, to, opts)
  }

  /** Async delay in engine time. Cancellable via `signal`. */
  wait(seconds: number, signal?: AbortSignal): Promise<void> {
    return this.animation.wait(seconds, signal)
  }

  /**
   * Convenience wrapper, tween properties on `node.transform`, auto-scoped to
   * `node.abortSignal` (destroying the node rejects the returned Promise with
   * AbortError). Additional `opts.signal` is combined in.
   */
  animate(
    node: SceneNode,
    to: Partial<Transform2D>,
    opts: TweenOptions,
  ): Promise<void> {
    const combined = combineAbortSignals(node.abortSignal, opts.signal)
    return this.animation
      .tween(node.transform, to, { ...opts, signal: combined.signal })
      .finally(combined.dispose)
  }

  private fixedStep(fdt: number): void {
    if (this._paused) return
    // Every stage (primary + secondaries) walks its own scene tree for
    // `onFixedStep`. Behaviours on secondary stages, e.g. the tutorial
    // mini-stage's `PacketBehaviour`, need this to integrate velocity /
    // steer / capture just like the primary. Onus is on the caller to keep
    // fixed-step work cheap when they attach multiple stages.
    this.stepScene(this.primaryStage, fdt)
    for (const stage of this._stages) {
      this.stepScene(stage, fdt)
    }
  }

  private stepScene(stage: Stage, fdt: number): void {
    walkTree(stage.scene.root, (node) => {
      if (!node._hasFixedStepWork) return
      node.onFixedStep?.(fdt)
      const behaviours = node.behaviours
      for (let i = 0; i < behaviours.length; i++) {
        behaviours[i].onFixedStep?.(fdt)
      }
    })
  }
}
