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
   * Composite the canvas transparently, frame clear uses `clearRect` so the
   * CSS background shows through. `clearColor` is ignored in this mode.
   */
  transparent?: boolean
  fixedStepHz?: number
  maxDt?: number
  /** Initial camera viewport in world coords. Default 1920×1080. */
  initialViewport?: Rect
  /**
   * Dynamic-resolution policy for the primary stage. Presence enables it,
   * pass `{ enabled: false }` to keep it off. Secondary stages don't get it.
   */
  dynamicResolution?: Partial<DynamicResolutionOptions>
  /**
   * Renderer backend for the primary stage. Default `'canvas2d'`. Secondary
   * stages inherit unless overridden. Typically set via `?renderer=gpu`.
   */
  renderer?: RendererMode
  /**
   * MSAA sample count under GPU. `0`/`1` disables, `>1` allocates a
   * multisample renderbuffer resolved on present. Default 4. Secondary
   * stages inherit. No effect under Canvas.
   */
  msaaSamples?: number
}

// Landscape 16:9 by default. The kiosk is 3840×2160 and every dev browser
// is landscape too; specific games (e.g. the Germany-map one) override.
const DEFAULT_VIEWPORT: Rect = { x: 0, y: 0, width: 1920, height: 1080 }

/**
 * Core engine. Composes ticker, primary stage, input, animation, event bus.
 * One `Ticker` and one `Animator` drive the primary stage and any secondary
 * stages from `attachStage`. `debug` is null unless `?debug` is set.
 */
export class Engine {
  readonly ticker: Ticker
  readonly events: Emitter<EngineEvents>
  readonly canvas: HTMLCanvasElement
  /** Primary render surface. Legacy `engine.{renderer,scene,camera,layers}` getters delegate here. */
  readonly primaryStage: Stage
  readonly animation: Animator
  /** Renderer backend selected at construction, secondary stages inherit. */
  readonly rendererMode: RendererMode
  /** MSAA sample count inherited by secondary stages under GPU. */
  readonly msaaSamples: number
  /**
   * CPU work inside the last `frame()`, in seconds. NOT the vsync interval,
   * measured entry-to-render-end so idle waits don't inflate it. Well-behaved
   * 60 Hz reads 1-10 ms here despite the 16.67 ms rAF interval.
   */
  lastFrameWorkSec = 0

  debug: DebugController | null = null
  /**
   * When true, wraps per-node `onUpdate` and `draw` in `performance.mark` /
   * `measure`. DevTools User Timing lane shows a per-node flame chart. Opt
   * in via `?debug=perf`. Off overhead is one boolean check per node.
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
    // Primary stage is always interactive.
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
   * Attach a secondary `Stage`. Scene/camera/layers are independent, ticker
   * and animator are shared so tweens stay in sync. Throws if `canvas` is
   * already attached.
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
    // Secondary stages default to transparent, the parent HTML card owns
    // the background.
    const stage = new Stage(canvas, this, {
      initialViewport: opts.initialViewport,
      clearColor: opts.clearColor,
      transparent: opts.transparent ?? true,
      interactive: opts.interactive,
      name: opts.name,
      renderer: opts.renderer ?? this.rendererMode,
      msaaSamples: opts.msaaSamples ?? this.msaaSamples,
      onResize: opts.onResize,
    })
    this._stages.add(stage)
    this._attachedCanvases.add(canvas)
    return stage
  }

  /** Detach and dispose a secondary stage. Cascades AbortErrors through its scene. */
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
   * Callback at frame top BEFORE `InputSystem.beforeFrame()` reprojects
   * pointer world coords. Camera-moving subsystems hook here so pointer
   * state stays glued to the finger during motion.
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
    // CPU-work timer, see `lastFrameWorkSec`.
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

    // 6. Render every stage through its game camera, or the debug camera
    //    when the HUD has selected this stage and debug-camera is on.
    //    Debug overlays draw INSIDE `stage.render()` so they composite
    //    through the same `Gfx2D` pipeline as game content.
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
      // Skip the body when the node has no update work. See
      // SceneNode._hasUpdateWork.
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
