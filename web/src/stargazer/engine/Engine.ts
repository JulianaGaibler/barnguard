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
import { Stage, type StageOptions, type StagePointerEvents } from '../render/Stage'
import type { GfxDevice } from '../render/gfx/GfxDevice'
import { EngineStageManager } from './EngineStageManager'
import type { PhysicsWorld, PhysicsWorldConfig } from '../physics/PhysicsWorld'
import { DomTransformSync } from '../dom/DomTransformSync'
import { AccessibilityTree } from '../a11y/AccessibilityTree'
import type { LayoutRoot } from '../layout/LayoutRoot'

/**
 * Construction options for {@link Engine}.
 *
 * @category Engine
 */
export interface EngineOptions {
  canvas: HTMLCanvasElement
  /** Solid frame-clear color. Ignored when `transparent` is set. */
  clearColor?: string
  /**
   * Composite the canvas transparently, frame clear uses `clearRect` so the CSS
   * background shows through. `clearColor` is ignored in this mode.
   */
  transparent?: boolean
  /** Rate of the deterministic fixed step, in Hz. Default 120. */
  fixedStepHz?: number
  /** Upper bound on a render dt, in seconds. Default `1/30`. */
  maxDt?: number
  /**
   * Render frame-rate cap in Hz. Default 0 (uncapped). See
   * {@link Ticker.setMaxFps}.
   */
  maxFps?: number
  /** Smooth render `dt` to filter timer-precision jitter. Default true. */
  smoothTimestep?: boolean
  /** Initial camera viewport in world coords. Default 1920×1080. */
  initialViewport?: Rect
  /**
   * MSAA sample count. `0`/`1` disables, `>1` allocates a multisample
   * renderbuffer resolved on present. Default 4. Secondary stages inherit.
   */
  msaaSamples?: number
  /**
   * Attach a {@link PhysicsWorld} to the primary stage. `true` uses defaults;
   * pass a config to tune gravity, iterations, sleeping, etc. The fixed-step
   * loop drives it automatically. Secondary stages opt in via their own
   * `StageOptions.physics`. Default: no physics.
   */
  physics?: boolean | PhysicsWorldConfig
  /**
   * Test-only escape hatch: inject a prebuilt `GfxDevice` for the primary
   * stage instead of acquiring a real WebGL2 context. See
   * `StageOptions.gpuDevice`.
   */
  gpuDevice?: GfxDevice
}

/**
 * A physics world the engine steps each fixed tick, together with the node that
 * anchors it in the scene. Stages register their own world; a
 * `PhysicsWorldBehavior` registers one for its subtree. Enumerate them with
 * {@link Engine.physicsWorlds}.
 *
 * @category Physics
 */
export interface RegisteredPhysicsWorld {
  /** The world being stepped. */
  readonly world: PhysicsWorld
  /**
   * The node whose world transform maps physics-space coordinates into scene
   * coordinates. `null` means physics space is scene space (identity). The
   * debug overlay uses it to draw a world in the right place.
   */
  readonly spaceNode: SceneNode | null
  /** Short name shown in the debug HUD. */
  readonly label: string
}

/** Options for {@link Engine.registerPhysicsWorld}. */
export interface RegisterPhysicsWorldOptions {
  spaceNode?: SceneNode | null
  label?: string
}

// Landscape 16:9 by default. The kiosk is 3840×2160 and every dev browser
// is landscape too; specific games (e.g. the map-based one) override.
const DEFAULT_VIEWPORT: Rect = { x: 0, y: 0, width: 1920, height: 1080 }

/**
 * The core engine: a {@link Ticker}, a primary {@link Stage}, an
 * {@link InputSystem}, an {@link Animator}, and an event bus wired together. One
 * ticker and one animator drive the primary stage and any secondary stages
 * added with {@link Engine.attachStage}, so every canvas shares one clock and
 * tweens stay in sync.
 *
 * Most apps build this through `createEngineHost` rather than directly, the
 * host adds start/stop, pause/resume, and context-loss recovery on top. The
 * `renderer`, `scene`, and `camera` getters forward to the primary stage for
 * convenience.
 *
 * @category Engine
 */
export class Engine {
  readonly ticker: Ticker
  readonly events: Emitter<EngineEvents>
  readonly canvas: HTMLCanvasElement
  /**
   * Primary render surface. Legacy `engine.{renderer,scene,camera}` getters
   * delegate here.
   */
  readonly primaryStage: Stage
  readonly animation: Animator
  /** MSAA sample count inherited by secondary stages. */
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
   * `measure`. DevTools User Timing lane shows a per-node flame chart. Opt in
   * via `?debug=perf`. Off overhead is one boolean check per node.
   */
  perfMarks = false

  readonly #stageManager: EngineStageManager
  readonly #physicsWorlds = new Set<RegisteredPhysicsWorld>()
  readonly #layoutRoots = new Set<LayoutRoot>()
  #dom: DomTransformSync | null = null
  #a11y: AccessibilityTree | null = null
  readonly #disposeCallbacks: Array<() => void> = []
  readonly #beforeFrameHandlers = new Set<(dt: number) => void>()
  #disposed = false
  #hasEmittedReady = false
  #_paused = false

  constructor(opts: EngineOptions) {
    this.canvas = opts.canvas
    this.events = createEmitter<EngineEvents>()
    this.ticker = createTicker({
      fixedStepHz: opts.fixedStepHz,
      maxDt: opts.maxDt,
      maxFps: opts.maxFps,
      smoothTimestep: opts.smoothTimestep,
    })
    this.msaaSamples = opts.msaaSamples ?? 4
    // Primary stage is always interactive.
    this.primaryStage = new Stage(opts.canvas, this, {
      initialViewport: opts.initialViewport ?? DEFAULT_VIEWPORT,
      clearColor: opts.clearColor,
      transparent: opts.transparent ?? false,
      interactive: true,
      msaaSamples: this.msaaSamples,
      physics: opts.physics,
      gpuDevice: opts.gpuDevice,
      onResize: (info) => {
        // Only the primary stage's resize emits on the engine event bus.        // secondary stages resize silently.
        this.events.emit('resize', {
          pixel: info.pixelSize,
          css: info.cssSize,
          dpr: info.dpr,
        })
      },
    })
    this.#stageManager = new EngineStageManager(opts.canvas)
    this.animation = new Animator()

    // A stage-owned world joins the same registry as behavior-owned worlds so
    // there's one list to step and one list for the debugger to read.
    if (this.primaryStage.physics) {
      this.registerPhysicsWorld(this.primaryStage.physics, {
        spaceNode: this.primaryStage.scene.root,
        label: this.primaryStage.name ?? 'stage',
      })
    }

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
      this.#disposeCallbacks.push(off)
    }

    this.ticker.onFrame((dt) => this.#frame(dt))
    this.ticker.onFixedStep((fdt) => this.#fixedStep(fdt))
    // Kiosk hygiene now lives on Stage, every canvas Stage owns gets it,
    // including secondaries mounted from Svelte components.
  }

  /** Shortcut for the primary stage's `InputSystem`. Always defined. */
  get input(): InputSystem {
    // Non-null: primaryStage is always constructed with `interactive: true`.
    return this.primaryStage.input!
  }

  /** The primary stage's {@link PhysicsWorld}, or `null` when physics is off. */
  get physics(): PhysicsWorld | null {
    return this.primaryStage.physics
  }

  /**
   * Register a {@link PhysicsWorld} so the fixed-step loop steps it and the
   * debug HUD can inspect it. Returns a function that unregisters the world;
   * call it when the world goes away. Stages register their own world
   * automatically; a `PhysicsWorldBehavior` calls this for its subtree.
   *
   * @example
   *   const world = new PhysicsWorld()
   *   const off = engine.registerPhysicsWorld(world, { label: 'arena' })
   *   // ...later, when the arena is torn down:
   *   off()
   */
  registerPhysicsWorld(
    world: PhysicsWorld,
    opts: RegisterPhysicsWorldOptions = {},
  ): () => void {
    const entry: RegisteredPhysicsWorld = {
      world,
      spaceNode: opts.spaceNode ?? null,
      label: opts.label ?? 'world',
    }
    this.#physicsWorlds.add(entry)
    return () => {
      this.#physicsWorlds.delete(entry)
    }
  }

  /** Every physics world the engine currently steps. */
  get physicsWorlds(): readonly RegisteredPhysicsWorld[] {
    return [...this.#physicsWorlds]
  }

  /**
   * Register a {@link LayoutRoot} so the engine runs its layout pass each frame,
   * only when the root is dirty. Returns an unregister function. A `LayoutRoot`
   * calls this from its constructor and the returned function from `destroy`,
   * so game code never touches it directly.
   */
  registerLayoutRoot(root: LayoutRoot): () => void {
    this.#layoutRoots.add(root)
    return () => {
      this.#layoutRoots.delete(root)
    }
  }

  /** Every {@link LayoutRoot} the engine currently drives. */
  get layoutRoots(): readonly LayoutRoot[] {
    return [...this.#layoutRoots]
  }

  // Backwards-compat getters, external code keeps using `engine.renderer`,
  // `engine.scene`, `engine.camera` unchanged.
  get renderer(): Renderer {
    return this.primaryStage.renderer
  }
  get scene(): Scene {
    return this.primaryStage.scene
  }
  get camera(): Camera {
    return this.primaryStage.camera
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
    return this.#_paused
  }
  setPaused(v: boolean): void {
    this.#_paused = v
  }

  /** Read-only view of currently-attached secondary stages. */
  get stages(): ReadonlySet<Stage> {
    return this.#stageManager.stages
  }

  /**
   * The {@link DomTransformSync} for this engine, created on first use. Attach
   * HTML elements to scene nodes so the engine keeps them flush with the
   * canvas. Absent until touched, so engines that never use it pay nothing.
   */
  get dom(): DomTransformSync {
    if (!this.#dom) this.#dom = new DomTransformSync(this)
    return this.#dom
  }

  /**
   * The optional {@link AccessibilityTree} for this engine, created on first
   * use. Register scene nodes to mirror them into a hidden, screen-reader
   * readable HTML tree. Absent until touched, so engines that never use it (a
   * touchscreen kiosk) pay nothing.
   */
  get a11y(): AccessibilityTree {
    if (!this.#a11y) this.#a11y = new AccessibilityTree(this)
    return this.#a11y
  }

  /**
   * The stage whose scene is `scene`, or `null` if none. Resolves a node back
   * to the camera that renders it (the primary stage, then any secondary).
   */
  stageForScene(scene: Scene | null): Stage | null {
    if (!scene) return null
    if (this.primaryStage.scene === scene) return this.primaryStage
    for (const s of this.#stageManager.stages) {
      if (s.scene === scene) return s
    }
    return null
  }

  /**
   * Attach a secondary `Stage`. Scene/camera/layers are independent, ticker and
   * animator are shared so tweens stay in sync. Throws if `canvas` is already
   * attached.
   */
  attachStage(canvas: HTMLCanvasElement, opts: StageOptions = {}): Stage {
    if (this.#disposed) {
      throw new Error('stargazer: attachStage after engine.destroy()')
    }
    return this.#stageManager.attachStage(this, canvas, opts)
  }

  /**
   * Detach and dispose a secondary stage. Cascades AbortErrors through its
   * scene.
   */
  detachStage(stage: Stage): void {
    // Let the debug controller flip its active-stage selection back to
    // primary if this was the inspected stage.
    this.#stageManager.detachStage(stage, (s) => this.debug?.onStageDetached(s))
  }

  /**
   * Callback at frame top BEFORE `InputSystem.beforeFrame()` reprojects pointer
   * world coords. Camera-moving subsystems hook here so pointer state stays
   * glued to the finger during motion.
   */
  onBeforeFrame(cb: (dt: number) => void): () => void {
    this.#beforeFrameHandlers.add(cb)
    return () => {
      this.#beforeFrameHandlers.delete(cb)
    }
  }

  start(): void {
    if (this.#disposed) return
    this.ticker.start()
    if (!this.#hasEmittedReady) {
      this.#hasEmittedReady = true
      this.events.emit('ready', {
        pixelSize: { ...this.renderer.pixelSize },
      })
    }
  }

  stop(): void {
    if (this.#disposed) return
    this.ticker.stop()
  }

  destroy(): void {
    if (this.#disposed) return
    this.#disposed = true
    this.stop()
    // Reject every outstanding tween/wait with AbortError before we start
    // tearing scenes apart, otherwise dangling Promises hang forever.
    this.animation.cancelAll()
    this.#dom?.dispose()
    this.#dom = null
    this.#a11y?.dispose()
    this.#a11y = null
    this.debug?.destroy()
    this.debug = null
    // Dispose secondaries first so cascade order is deterministic. Each
    // Stage.dispose() tears down its own InputSystem (if any).
    this.#stageManager.disposeAll()
    this.primaryStage.dispose()
    for (const fn of this.#disposeCallbacks) fn()
    this.#disposeCallbacks.length = 0
    this.#beforeFrameHandlers.clear()
    this.events.emit('destroyed', undefined)
  }

  #frame(dt: number): void {
    // CPU-work timer, see `lastFrameWorkSec`.
    const workT0 = performance.now()
    // 1. Before-frame hooks, subsystems that MUTATE the active camera
    //    (debug camera step, camera tweens) run here so step 2 sees the
    //    up-to-date camera. Runs even when paused so the debug camera
    //    stays interactive during a debug freeze.
    for (const cb of this.#beforeFrameHandlers) cb(dt)

    // 2. Input: reproject pointer world coords, emit synthetic moves for
    //    any pointer whose world drifted under a still finger this frame.
    //    Skipped while paused, a debug freeze should not fire game-side
    //    pointerMove callbacks either. Every interactive stage runs its own
    //    beforeFrame so secondaries stay glued to fingers under camera pan.
    if (!this.#_paused) {
      this.primaryStage.input?.beforeFrame()
      for (const s of this.#stageManager.stages) {
        if (s.active) s.input?.beforeFrame()
      }
    }

    if (!this.#_paused) {
      // 3. Advance active tweens and waits FIRST so game code in the update
      //    pass reads the freshest transform values.
      this.animation.tick(dt)

      // 4. Update pass, walk every stage's scene tree. Behavior hooks may
      //    read pointer state (primary input). Inactive secondary stages
      //    (e.g. a parked demo stage) are skipped entirely.
      this.#walkUpdate(this.primaryStage, dt)
      for (const stage of this.#stageManager.stages) {
        if (stage.active) this.#walkUpdate(stage, dt)
      }
    }

    // 4.5. Layout: re-measure/arrange any dirty layout roots BEFORE transform
    //      propagation so arranged positions land this frame. Runs even while
    //      paused (a resize during a debug freeze still reflows); each root is a
    //      no-op unless dirty, and the set is empty when no layout is in use.
    for (const root of this.#layoutRoots) root._runIfDirty()

    // 5. Transform propagation, every active stage, always. Idempotent when
    //    nothing changed; needed even while paused so debug-camera pans reflect
    //    in the primary render output. Inactive stages are skipped (nothing
    //    mutated them, so their world matrices are already correct).
    this.primaryStage.updateTransforms()
    for (const stage of this.#stageManager.stages) {
      if (stage.active) stage.updateTransforms()
    }

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
    for (const stage of this.#stageManager.stages) {
      if (!stage.active) continue
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

  #walkUpdate(stage: Stage, dt: number): void {
    const marks = this.perfMarks
    walkTree(stage.scene.root, (node) => {
      // Skip the body when the node has no update work. See
      // SceneNode._hasUpdateWork.
      if (!node._hasUpdateWork) return
      const id = marks ? node.id : ''
      const startMark = marks ? `update-${id}:start` : ''
      if (marks) performance.mark(startMark)
      node.onUpdate?.(dt)
      const behaviors = node.behaviors
      for (let i = 0; i < behaviors.length; i++) {
        behaviors[i].onUpdate?.(dt)
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

  #fixedStep(fdt: number): void {
    if (this.#_paused) return
    // Step every registered world before any scene walk so game `onFixedStep`
    // hooks and behaviors observe post-step body state this tick. Iterate a
    // snapshot: a collision callback may destroy a node, which unregisters its
    // world mid-step, and mutating the live Set while iterating would skip
    // entries.
    for (const entry of [...this.#physicsWorlds]) entry.world.step(fdt)

    // Every stage (primary + secondaries) walks its own scene tree for
    // `onFixedStep`. Behaviors on secondary stages, e.g. the tutorial
    // mini-stage's `PacketBehavior`, need this to integrate velocity /
    // steer / capture just like the primary. Onus is on the caller to keep
    // fixed-step work cheap when they attach multiple stages.
    this.#stepScene(this.primaryStage, fdt)
    for (const stage of this.#stageManager.stages) {
      if (stage.active) this.#stepScene(stage, fdt)
    }
  }

  #stepScene(stage: Stage, fdt: number): void {
    walkTree(stage.scene.root, (node) => {
      if (!node._hasFixedStepWork) return
      node.onFixedStep?.(fdt)
      const behaviors = node.behaviors
      for (let i = 0; i < behaviors.length; i++) {
        behaviors[i].onFixedStep?.(fdt)
      }
    })
  }
}
