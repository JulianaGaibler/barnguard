import { createEmitter, type Emitter } from '../events/Emitter'
import type { Engine, RegisteredPhysicsWorld } from '../engine/Engine'
import type { CameraView2D } from '../camera/CameraView2D'
import type { Stage } from '../render/Stage'
import type { Gfx2D } from '../render/gfx/Gfx2D'
import type { GfxBackend } from '../render/gfx/GfxDevice'
import type { BitmapMask } from '../assets/BitmapMask'
import { DebugCamera } from './DebugCamera'
import { DebugCamera3D } from './DebugCamera3D'
import { FrameStats } from './FrameStats'
import type { CameraView3D } from '../camera/CameraView3D'
import type { Node3D } from '../scene/Node3D'
import { MeshNode } from '../nodes/MeshNode'
import { Viewport2DNode } from '../nodes/Viewport2DNode'
import type { DebugLine3DRenderer } from '../render/gfx/DebugLine3DRenderer'
import { Light3D } from '../nodes/Light3D'
import type { RenderQuality } from '../render/RenderQuality'
import type { AmbientOcclusion } from '../render/gfx/ao/AmbientOcclusion'
import { walkTree } from '../scene/traverse'
import { drawGrid } from './DebugGridRenderer'
import {
  pushObb,
  drawLightGizmo,
  pushWireframe,
  pushQuadWireframe,
} from './DebugGizmo3DRenderer'
import { drawNodeOutlines } from './DebugOutlineRenderer'
import { drawLayoutOutlines } from './DebugLayoutRenderer'
import { drawPointerOverlay } from './DebugPointerRenderer'
import {
  drawPhysicsOverlay,
  type PhysicsOverlayFlags,
} from './DebugPhysicsRenderer'
import { BodyType } from '../physics/types'
import type { PhysicsWorld } from '../physics/PhysicsWorld'
import type { Node } from '../scene/Node'
import type { Node2D } from '../scene/Node2D'
import { get, writable, type Readable } from 'svelte/store'
import type { Component } from 'svelte'
// Global debug UI styles, imported by the module that owns debug so we get
// the debug chrome CSS in the bundle exactly when debug code is used. Since
// this file is dynamically loaded only from `EngineHost` (which itself is
// tree-shakeable to whatever imports `createEngineHost`), the styles ride
// along automatically without polluting production bundles that never touch
// the debug controller.
import './ui/debug-ui.sass'

/**
 * Current on/off state of every debug toggle, emitted on the `toggle` event.
 *
 * @category Debug
 */
/**
 * Which camera drives the debug view. `active` is the engine's normal cameras
 * (no override); `debug-2d` swaps in the free 2D pan/zoom camera; `debug-3d`
 * swaps in the free 3D fly camera. The grid, outlines, and camera pad follow
 * the selected mode's space.
 *
 * @category Debug
 */
export type DebugCameraMode = 'active' | 'debug-2d' | 'debug-3d'

/**
 * Debug render view for the 3D mesh pass. `normal` is the shaded scene;
 * `wireframe` overlays triangle edges; `unshaded` shows flat albedo (no
 * lighting); `normals` colors fragments by world normal.
 */
export type DebugRenderMode =
  'normal' | 'wireframe' | 'unshaded' | 'normals' | 'ao'

export interface DebugToggleState {
  hud: boolean
  camera: boolean
  /** Space the debug camera / grid / pad act on. */
  space: '2d' | '3d'
  /** The selected camera mode (drives the HUD dropdown). */
  cameraMode: DebugCameraMode
  /** The selected 3D render view (drives the HUD dropdown). */
  renderMode: DebugRenderMode
  outlines: boolean
  layoutOutlines: boolean
  follow: boolean
  grid: boolean
  paused: boolean
  pointerOverlay: boolean
  physics: PhysicsOverlayFlags
  /** Whether the fly camera currently holds the pointer lock (mouse-look on). */
  flyPointerLocked: boolean
}

/**
 * Flattened view of one active pointer, shaped for the HUD's pointer sections.
 *
 * @category Debug
 */
export interface ActivePointerReadout {
  id: number
  kind: 'touch' | 'mouse' | 'pen'
  screen: { x: number; y: number }
  world: { x: number; y: number }
  capturedByNodeId: string | null
}

/**
 * One entry per attached stage, surfaced to the HUD for the chip strip.
 *
 * @category Debug
 */
export interface StageChip {
  /** Stable identifier, `'primary'` or `'stage-{N}'`. */
  id: string
  /** Display label, `stage.name ?? \`Stage {N}`` (primary is always "Primary"). */
  label: string
  isActive: boolean
  isPrimary: boolean
}

/**
 * Per-frame GPU pipeline counters, read from the WebGL2 backend for the HUD.
 *
 * @category Debug
 */
export interface DebugGpuStatsReadout {
  drawCalls: number
  programSwitches: number
  textureBinds: number
  blendSwitches: number
  overflowWarns: number
  sdfInstances: number
  strokeInstances: number
  roundRectInstances: number
  /** Effective MSAA sample count on the offscreen render target. `1` = off. */
  msaaSamples: number
}

/**
 * One frame's worth of debug metrics for the active stage. Produced by
 * {@link DebugController.snapshotStats} and consumed by the HUD.
 *
 * @category Debug
 */
export interface DebugStatsSnapshot {
  /** CPU work-time percentiles (seconds) per frame, headroom, NOT frame cadence. */
  p50: number
  p95: number
  p99: number
  max: number
  count: number
  /**
   * Actual frames per second, from the real post-cap frame interval. Reflects
   * the FPS cap and vsync. `0` when not yet measured.
   */
  fps: number
  nodeCounts: {
    static: number
    aboveStatic: number
    dynamic: number
    total: number
  }
  /** Per-frame GPU pipeline stats for the active stage. */
  gpu: DebugGpuStatsReadout
  /** Which rendering backend the active stage's device is. */
  backend: GfxBackend
  cameraMode: 'game' | 'debug'
  cameraFollowing: boolean
  viewport: { x: number; y: number; width: number; height: number }
  screenPxPerWorldUnit: number
  pointerScreen: { x: number; y: number } | null
  pointerWorld: { x: number; y: number } | null
  canvasCss: { w: number; h: number }
  canvasDevice: { w: number; h: number }
  dpr: number
  activePointers: ActivePointerReadout[]
  touchSlopScreen: number
  touchSlopWorld: number
  aliveParticles: number
  /** All currently-attached stages, in order (primary first). */
  stages: StageChip[]
  /** Id of the currently-active stage, matches one entry in `stages`. */
  activeStageId: string
  /** True when the active stage isn't the primary. HUD grays pointer sections. */
  activeIsPrimary: boolean
  /** True when the active stage has its own `InputSystem`. */
  activeHasInput: boolean
  /** One entry per physics world in the active stage; empty when it has none. */
  physics: PhysicsWorldReadout[]
  /** 3D world stats for the active stage, or `null` when it has no 3D content. */
  world3d: World3DReadout | null
  /** Whether the fly camera currently holds the pointer lock (mouse-look on). */
  flyPointerLocked: boolean
  /** The fly camera's persistent scroll-adjustable speed multiplier. */
  flySpeedMultiplier: number
}

/**
 * 3D world + camera metrics for the active stage, shown in the HUD's Rendering
 * (3D subsection) and Camera panels.
 *
 * @category Debug
 */
export interface World3DReadout {
  nodeCount: number
  meshCount: number
  /** RTT surfaces (Viewport2DNodes) in the world. */
  rttSurfaces: number
  /** Total triangles across all mesh geometry (not culled). */
  triangleCount: number
  /** Meshes + surfaces actually drawn last frame. */
  visible: number
  /** 3D draw calls last frame (meshes + RTT quads). */
  drawCalls: number
  /** Whether the 3D fly-camera is inspecting the scene. */
  cameraMode: 'game' | 'debug'
  camera: {
    position: { x: number; y: number; z: number }
    projectionness: number
    fovY: number
    near: number
    far: number
    aspect: number
    focalDistance: number
  }
}

/**
 * Live stats for one physics world in the active stage, shown in the HUD's
 * Physics panel. One of these per world; several worlds can coexist in a
 * stage.
 *
 * @category Debug
 */
export interface PhysicsWorldReadout {
  /** Stable id for keying the HUD list within one snapshot. */
  id: string
  /** The world's label, from its registration. */
  label: string
  /** CSS color used for this world in the panel swatch and the overlay. */
  accent: string
  bodyCount: number
  sleeping: number
  static: number
  dynamic: number
  kinematic: number
  /** Solid contact manifolds from the last step (sensors excluded). */
  contactCount: number
  atRest: boolean
  gravity: { x: number; y: number }
}

/**
 * Event map for {@link DebugController.events}.
 *
 * @category Debug
 */
export interface DebugEvents {
  toggle: DebugToggleState
  /**
   * Emitted when `setActiveStage` (or auto-cleanup on detach) changes
   * selection.
   */
  stageChanged: { activeStageId: string }
}

/**
 * Initial toggle state for a {@link DebugController}. Everything defaults to
 * off.
 *
 * @category Debug
 */
export interface DebugControllerOptions {
  /** Show the HUD on construction. */
  showHud?: boolean
  /** Draw node outlines on construction. */
  showOutlines?: boolean
  /** Draw the world grid on construction. */
  showGrid?: boolean
}

/**
 * Consumer-supplied panel spec. Passed to `DebugController.registerPanel` to
 * append a section to the HUD without any stargazer → game coupling.
 *
 * The `component` is instantiated by `DebugHud.svelte` inside a `DebugSection`
 * wrapper; it receives `debug: DebugController` as a prop plus anything the
 * caller spreads via `props`. Prop-type correctness is the caller's
 * responsibility, we deliberately widen `props` to `Record<string, unknown>`
 * here so the stargazer stays generic.
 *
 * @category Debug
 */
export interface DebugPanelSpec {
  /**
   * Stable id, used for keying + deregistration. Must be unique across
   * registered panels; a re-register with the same id replaces the previous
   * entry.
   */
  id: string
  /** Header text shown at the top of the panel's `DebugSection`. */
  title: string
  /**
   * Sort key. Panels sort ascending by `order` (default `Infinity` →
   * registration-order append). Reserve values for stable ordering across
   * dynamic registers/unregisters.
   */
  order?: number
  /** Svelte component to instantiate inside the panel's section. */
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  component: Component<any>
  /** Optional prop bag spread alongside `debug` when instantiating. */
  props?: Record<string, unknown>
}

/**
 * Central controller for engine debug tooling. Constructed only when `?debug=1`
 * or `?debug=hud` is present in the URL, the entire object graph (hotkeys, ring
 * buffers, debug camera) is absent otherwise.
 *
 * The `activeStage` concept scopes stage-per-stage UI: sections (Coordinates,
 * Camera, Scene, Scene tree, Camera pad) show data for the selected stage.
 * Global sections (Performance, Pause) are unaffected. Pointer sections follow
 * the active stage's `InputSystem`, when it has one, its pointers show up in
 * the readouts; when it doesn't, the section shows a hint.
 *
 * @category Debug
 */
export class DebugController {
  readonly enabled = true as const
  readonly camera: DebugCamera
  /** CPU work-time per frame (headroom); drives the frame graph + `CPU pXX`. */
  readonly frameStats: FrameStats
  /** Real (post-cap) frame interval per frame; drives the actual FPS readout. */
  readonly #frameIntervalStats = new FrameStats(300)
  readonly events: Emitter<DebugEvents>
  /** Read-only handle for HUD components that need scene / input access. */
  readonly engine: Engine

  /**
   * HUD visibility, backed by a Svelte writable so external components (like
   * the booth menu) can subscribe to changes without wiring the `toggle` event
   * by hand. `toggleHud()` / `setHudVisible()` both write here; the
   * `hudVisible` getter reads `get(store)` synchronously for plain-JS callers.
   */
  readonly #hudVisibleStore = writable<boolean>(false)
  /** Reactive HUD visibility, subscribe from Svelte with `$`. */
  readonly hudVisible$: Readable<boolean> = this.#hudVisibleStore
  #_cameraActive = false
  #_outlinesVisible = false
  #_layoutOutlinesVisible = false
  #_followGameCamera = false
  #_gridVisible = false
  #_pointerOverlayVisible = false
  /**
   * Which space the debug camera, grid, and camera pad act on. One mode at a
   * time, so the 2D and 3D grids never draw together and the pad/keys drive the
   * matching debug camera.
   */
  #_debugSpace: '2d' | '3d' = '2d'
  /** 3D fly-camera, created lazily the first time 3D mode's camera activates. */
  #debugCamera3d: DebugCamera3D | null = null
  /** Whether the pointer is locked to the canvas for fly-camera mouse-look. */
  #_flyPointerLocked = false
  /** 3D node whose bounds the gizmo pass highlights, driven by the Scene panel. */
  #highlightedNode3d: Node3D | null = null
  #_physicsFlags: PhysicsOverlayFlags = {
    colliders: false,
    aabbs: false,
    contacts: false,
    velocities: false,
  }
  /** Cached OR of `_physicsFlags`, so `drawOverlay` is one test when all off. */
  #_physicsAny = false
  /**
   * Stable overlay color per world, assigned on first sight from a fixed
   * palette. Keying by the world (not a render-time index) keeps a color from
   * shifting when another world is removed.
   */
  readonly #worldAccents = new Map<PhysicsWorld, string>()
  /** Node whose bounds the overlay highlights, driven by the Scene panel. */
  #highlightedNode: Node2D | null = null
  #_activeStage: Stage | null = null // null → primary

  #_pointerScreen: { x: number; y: number } | null = null

  /**
   * Currently-inspected clip mask, surfaced in the HUD via the `'clip-mask'`
   * render mode as a translucent red overlay. Set by the game session (or any
   * consumer holding the same `BitmapMask` used by `GridOverlayNode`). Null
   * when nothing is registered.
   */
  #_inspectedMask: BitmapMask | null = null

  readonly #disposeCallbacks: Array<() => void> = []

  /**
   * Registered consumer panels, surfaced to `DebugHud.svelte` for
   * append-after-built-ins rendering. Backed by a Svelte writable so the HUD's
   * `#each` re-runs whenever a panel registers or unregisters. Sort-by-`order`
   * happens on read (see the `panels` getter).
   */
  readonly #panelsStore = writable<DebugPanelSpec[]>([])
  /**
   * Public readable view of the registered-panels list. Sorted ascending by
   * `order` (unset = `Infinity`, keeping ordered panels first and
   * registration-order for the rest).
   */
  readonly panels: Readable<DebugPanelSpec[]> = this.#panelsStore

  constructor(engine: Engine, opts: DebugControllerOptions = {}) {
    this.engine = engine
    this.camera = new DebugCamera(engine.currentCamera2D)
    this.frameStats = new FrameStats(300)
    this.events = createEmitter<DebugEvents>()

    this.#hudVisibleStore.set(opts.showHud ?? false)
    this.#_outlinesVisible = opts.showOutlines ?? false
    this.#_gridVisible = opts.showGrid ?? false

    const onKeyDown = (e: KeyboardEvent): void => this.#onKeyDown(e)
    const onKeyUp = (e: KeyboardEvent): void => this.#onKeyUp(e)
    window.addEventListener('keydown', onKeyDown)
    window.addEventListener('keyup', onKeyUp)
    this.#disposeCallbacks.push(() => {
      window.removeEventListener('keydown', onKeyDown)
      window.removeEventListener('keyup', onKeyUp)
    })

    // Pointer tracking, primary canvas only (secondaries have no input).
    const canvas = engine.canvas
    const onPointerMove = (e: PointerEvent): void => {
      const rect = canvas.getBoundingClientRect()
      this.#_pointerScreen = {
        x: e.clientX - rect.left,
        y: e.clientY - rect.top,
      }
    }
    const onPointerLeave = (): void => {
      this.#_pointerScreen = null
    }
    canvas.addEventListener('pointermove', onPointerMove)
    canvas.addEventListener('pointerleave', onPointerLeave)
    canvas.addEventListener('pointercancel', onPointerLeave)
    this.#disposeCallbacks.push(() => {
      canvas.removeEventListener('pointermove', onPointerMove)
      canvas.removeEventListener('pointerleave', onPointerLeave)
      canvas.removeEventListener('pointercancel', onPointerLeave)
    })

    // Fly-camera mouse-look via Pointer Lock. A mouse press on the canvas while
    // the 3D fly camera is active requests the lock (cursor hidden, unlimited
    // turning). We hook `pointerdown`, not `click`: the InputSystem calls
    // `preventDefault` + `setPointerCapture` on canvas `pointerdown`, which
    // suppresses the synthetic `click`. A separate bubble-phase listener still
    // fires (InputSystem does not stopPropagation), and `pointerdown` is a valid
    // user gesture for the lock request. Non-mouse pointers keep the touch pad.
    const onLockPointerDown = (e: PointerEvent): void => {
      if (e.pointerType !== 'mouse') return
      if (!this.camera3dActive || this.#_flyPointerLocked) return
      // May reject during the browser's brief post-Esc lock-out, or if the
      // gesture is stale. Swallow it rather than spamming the console.
      const p = canvas.requestPointerLock() as unknown as
        Promise<void> | undefined
      if (p && typeof p.catch === 'function') p.catch(() => {})
    }
    const onLockError = (): void => {
      this.#_flyPointerLocked = false
    }
    // While locked the browser reports raw motion through `movementX/Y`. The fly
    // camera is created lazily, so null-guard it.
    const onLockMove = (e: MouseEvent): void => {
      if (this.#_flyPointerLocked)
        this.#debugCamera3d?.look(e.movementX, e.movementY)
    }
    const onLockChange = (): void => {
      this.#_flyPointerLocked = document.pointerLockElement === canvas
      // Esc unlocks but stays in fly mode. Drop any held sprint so the camera
      // does not keep sprinting after the mouse releases.
      if (!this.#_flyPointerLocked) this.#debugCamera3d?.setSprint(false)
      this.#emitToggle()
    }
    // Scroll adjusts the persistent fly speed while the 3D fly camera is active.
    const onWheel = (e: WheelEvent): void => {
      if (!this.camera3dActive || !this.#debugCamera3d) return
      this.#debugCamera3d.adjustSpeedMultiplier(e.deltaY)
      e.preventDefault()
    }
    canvas.addEventListener('pointerdown', onLockPointerDown)
    canvas.addEventListener('wheel', onWheel, { passive: false })
    document.addEventListener('mousemove', onLockMove)
    document.addEventListener('pointerlockchange', onLockChange)
    document.addEventListener('pointerlockerror', onLockError)
    this.#disposeCallbacks.push(() => {
      canvas.removeEventListener('pointerdown', onLockPointerDown)
      canvas.removeEventListener('wheel', onWheel)
      document.removeEventListener('mousemove', onLockMove)
      document.removeEventListener('pointerlockchange', onLockChange)
      document.removeEventListener('pointerlockerror', onLockError)
    })

    // Releasing focus (tab switch, window blur) can strand held keys and the
    // pointer lock. Clear movement, sprint, and the lock so the camera does not
    // fly off on its own while the tab is hidden.
    const onDefocus = (): void => {
      this.#debugCamera3d?.clearKeys()
      this.#exitPointerLock()
    }
    document.addEventListener('visibilitychange', onDefocus)
    window.addEventListener('blur', onDefocus)
    this.#disposeCallbacks.push(() => {
      document.removeEventListener('visibilitychange', onDefocus)
      window.removeEventListener('blur', onDefocus)
    })

    // Camera step runs BEFORE input reprojection so a WASD-panning debug
    // camera doesn't drag pointer state behind by one frame. Sized against
    // the active stage so pan feel is consistent regardless of canvas.
    const offBefore = engine.onBeforeFrame((dt) => {
      if (!this.#_cameraActive) return
      if (this.#_debugSpace === '2d') {
        const active = this.activeStage
        this.camera.setPixelSize(
          active.renderer.cssSize.w,
          active.renderer.cssSize.h,
        )
        this.camera.step(dt)
      } else if (this.#debugCamera3d) {
        this.#debugCamera3d.step(dt)
      }
    })
    // Frame-time sample: push the CPU work-time recorded by
    // `Engine.frame`, NOT the rAF `dt` (which is locked to the vsync
    // interval ~16.67 ms at 60 Hz regardless of actual work). See
    // `engine.lastFrameWorkSec` for the derivation. This is the value
    // that answers "did this frame have headroom or is it right at
    // budget?", the vsync-locked dt can't distinguish the two.
    const offFrame = engine.ticker.onFrame(() => {
      this.frameStats.push(engine.lastFrameWorkSec)
      // Actual FPS comes from the true frame interval (`ticker.rawDt`):
      // unsmoothed and unclamped, so a genuinely slow frame reads as a low rate.
      // The callback's `dt` argument is the smoothed + `maxDt`-clamped
      // simulation delta and would floor the readout at `1 / maxDt` (30 FPS).
      this.#frameIntervalStats.push(engine.ticker.rawDt)
    })
    this.#disposeCallbacks.push(offBefore, offFrame)
  }

  /**
   * Register a consumer-supplied panel for the HUD to render below its built-in
   * sections. Returns an unregister function; call it when the consumer
   * unmounts (usually from a `$effect` cleanup) so the panel doesn't outlive
   * its own state.
   *
   * Re-registering the same `id` replaces the previous spec, safe to call
   * inside a reactive effect whose deps change.
   */
  registerPanel(spec: DebugPanelSpec): () => void {
    this.#panelsStore.update((list) => {
      const without = list.filter((p) => p.id !== spec.id)
      const next = [...without, spec]
      // Sort by `order` (undefined = Infinity so unordered panels append
      // in registration order after any explicitly-ordered ones).
      next.sort((a, b) => (a.order ?? Infinity) - (b.order ?? Infinity))
      return next
    })
    return () => {
      this.#panelsStore.update((list) => list.filter((p) => p.id !== spec.id))
    }
  }

  get hudVisible(): boolean {
    return get(this.#hudVisibleStore)
  }
  get cameraActive(): boolean {
    return this.#_cameraActive
  }
  get outlinesVisible(): boolean {
    return this.#_outlinesVisible
  }
  get layoutOutlinesVisible(): boolean {
    return this.#_layoutOutlinesVisible
  }
  get followGameCamera(): boolean {
    return this.#_followGameCamera
  }
  get gridVisible(): boolean {
    return this.#_gridVisible
  }
  get pointerOverlayVisible(): boolean {
    return this.#_pointerOverlayVisible
  }
  get paused(): boolean {
    return this.engine.paused
  }
  /** Live 3D rendering-quality settings; the Rendering panel overrides these. */
  get quality(): RenderQuality {
    return this.engine.quality
  }
  /**
   * The primary stage's ambient-occlusion controller, created on access — the
   * Rendering panel touches this only when the operator enables AO, so a 3D
   * scene that never turns it on warms no AO pipelines.
   */
  get ambientOcclusion(): AmbientOcclusion {
    return this.engine.primaryStage.ambientOcclusion
  }
  /** The AO controller only if already created (for read-only HUD mirroring). */
  get ambientOcclusionPeek(): AmbientOcclusion | null {
    return this.engine.primaryStage.peekAmbientOcclusion()
  }
  get perfMarks(): boolean {
    return this.engine.perfMarks
  }
  setPerfMarks(enabled: boolean): void {
    this.engine.perfMarks = enabled
  }
  /** Current render frame-rate cap in Hz, or 0 when uncapped. */
  get maxFps(): number {
    return this.engine.ticker.maxFps
  }
  /** Cap the render frame rate (Hz); 0 removes the cap. */
  setMaxFps(fps: number): void {
    this.engine.ticker.setMaxFps(fps)
  }
  /** Whether render `dt` smoothing is on. */
  get smoothTimestep(): boolean {
    return this.engine.ticker.smoothTimestep
  }
  /** Toggle render `dt` smoothing (timer-jitter filter). */
  setSmoothTimestep(enabled: boolean): void {
    this.engine.ticker.setSmoothTimestep(enabled)
  }
  get inspectedMask(): BitmapMask | null {
    return this.#_inspectedMask
  }
  /**
   * Register the clip mask to visualise under the `'clip-mask'` render mode.
   * Session-side wiring: call once with the same `BitmapMask` passed to
   * `GridOverlayNode`. Passing `null` clears.
   */
  setInspectedMask(mask: BitmapMask | null): void {
    this.#_inspectedMask = mask
  }
  /**
   * The stage currently being inspected. Defaults to the primary; the HUD's
   * chip strip drives it via `setActiveStage`.
   */
  get activeStage(): Stage {
    return this.#_activeStage ?? this.engine.primaryStage
  }
  get activeIsPrimary(): boolean {
    return this.#_activeStage === null
  }

  /**
   * Point the HUD at a different stage. Pass `null` for the primary. Retargets
   * the debug camera so `follow` / `reset` behave against the new stage's game
   * camera.
   */
  setActiveStage(stage: Stage | null): void {
    if (this.#_activeStage === stage) return
    // Do not keep the mouse captured across a stage switch (the fly camera
    // retargets to the new stage).
    this.#exitPointerLock()
    // Passing the primary stage explicitly normalises to null.
    if (stage === this.engine.primaryStage) stage = null
    this.#_activeStage = stage
    const active = this.activeStage
    this.camera.setGameCamera(active.currentCamera2D)
    if (this.#_cameraActive) {
      this.camera.reset()
      this.camera.setPixelSize(
        active.renderer.cssSize.w,
        active.renderer.cssSize.h,
      )
    }
    this.events.emit('stageChanged', { activeStageId: this.#stageIdOf(active) })
  }

  /**
   * Notify the controller that a secondary stage was detached. If it was the
   * active one, snap back to the primary. Called by `Engine.detachStage`.
   */
  onStageDetached(stage: Stage): void {
    if (this.#_activeStage !== stage) return
    this.#exitPointerLock()
    this.#_activeStage = null
    this.camera.setGameCamera(this.engine.primaryStage.currentCamera2D)
    if (this.#_cameraActive) {
      this.camera.reset()
    }
    this.events.emit('stageChanged', { activeStageId: 'primary' })
  }

  toggleHud(): void {
    this.setHudVisible(!this.hudVisible)
  }

  /**
   * Set HUD visibility deterministically. No-op if already at the target value,
   * cheap to call from a `$effect` that mirrors a store.
   */
  setHudVisible(visible: boolean): void {
    if (visible === this.hudVisible) return
    this.#hudVisibleStore.set(visible)
    this.#emitToggle()
  }

  /**
   * Toggle the debug camera for the current {@link DebugController.debugSpace}.
   * In 2D mode it swaps in the pan/zoom `DebugCamera`; in 3D mode the fly
   * `DebugCamera3D`. Only one is ever active, matching the space.
   */
  toggleCamera(): void {
    this.#_cameraActive = !this.#_cameraActive
    if (this.#_cameraActive) this.#prepareDebugCamera()
    else this.#stopDebugCameras()
    this.#emitToggle()
  }

  /** The space the debug camera / grid / pad currently act on. */
  get debugSpace(): '2d' | '3d' {
    return this.#_debugSpace
  }

  /**
   * Switch the debug space (2D pan/zoom vs 3D fly). Carries an active debug
   * camera across: the old space's camera stops, the new space's camera engages
   * and snaps to its game camera.
   */
  setDebugSpace(space: '2d' | '3d'): void {
    if (this.#_debugSpace === space) return
    this.#_debugSpace = space
    if (this.#_cameraActive) {
      this.#stopDebugCameras()
      this.#prepareDebugCamera()
    }
    this.#emitToggle()
  }

  toggleDebugSpace(): void {
    this.setDebugSpace(this.#_debugSpace === '2d' ? '3d' : '2d')
  }

  #_renderMode: DebugRenderMode = 'normal'

  /** The selected 3D render view; see {@link DebugRenderMode}. */
  get renderMode(): DebugRenderMode {
    return this.#_renderMode
  }

  /** Select the 3D render view (the HUD dropdown's setter). */
  setRenderMode(mode: DebugRenderMode): void {
    if (mode === this.#_renderMode) return
    this.#_renderMode = mode
    this.#emitToggle()
  }

  /**
   * Mesh-shader debug mode uniform: 0 = normal/wireframe, 1 = unshaded, 2 =
   * normals.
   */
  get meshShaderMode(): number {
    return this.#_renderMode === 'unshaded'
      ? 1
      : this.#_renderMode === 'normals'
        ? 2
        : this.#_renderMode === 'ao'
          ? 3
          : 0
  }

  /** The camera driving the debug view; see `DebugCameraMode`. */
  get cameraMode(): DebugCameraMode {
    if (!this.#_cameraActive) return 'active'
    return this.#_debugSpace === '3d' ? 'debug-3d' : 'debug-2d'
  }

  /**
   * Select the debug view camera. `active` clears any debug camera; `debug-2d`
   * / `debug-3d` engage the free camera for that space (and set the space so
   * the grid + pad follow). This is the HUD dropdown's setter.
   */
  setCameraMode(mode: DebugCameraMode): void {
    if (mode === this.cameraMode) return
    if (mode === 'active') {
      this.#stopDebugCameras()
      this.#_cameraActive = false
    } else {
      const space = mode === 'debug-3d' ? '3d' : '2d'
      // Switching directly between 2D and 3D debug: drop the old camera's keys.
      if (this.#_cameraActive && this.#_debugSpace !== space)
        this.#stopDebugCameras()
      this.#_debugSpace = space
      this.#_cameraActive = true
      this.#prepareDebugCamera()
    }
    this.#emitToggle()
  }

  /** Engage the current-space debug camera against the active stage. */
  #prepareDebugCamera(): void {
    const active = this.activeStage
    if (this.#_debugSpace === '2d') {
      this.camera.setGameCamera(active.currentCamera2D)
      this.camera.reset()
      this.camera.setPixelSize(
        active.renderer.cssSize.w,
        active.renderer.cssSize.h,
      )
    } else {
      if (!this.#debugCamera3d)
        this.#debugCamera3d = new DebugCamera3D(active.currentCamera3D)
      else this.#debugCamera3d.setGameCamera(active.currentCamera3D)
      this.#debugCamera3d.reset()
    }
  }

  #stopDebugCameras(): void {
    this.camera.clearKeys()
    this.#debugCamera3d?.clearKeys()
    this.#exitPointerLock()
  }

  /** Release the fly-camera pointer lock if this canvas currently holds it. */
  #exitPointerLock(): void {
    if (document.pointerLockElement === this.engine.canvas)
      document.exitPointerLock()
  }

  /**
   * Route a camera-pad button to the current-space debug camera, auto-engaging
   * it on the first press so the pad works without first toggling the camera.
   * `code` is a `KeyW`/`KeyA`/… control key; `pressed` mirrors button down/up.
   */
  padKey(code: string, pressed: boolean): void {
    if (pressed && !this.#_cameraActive) this.toggleCamera()
    if (this.#_debugSpace === '2d') this.camera.setKey(code, pressed)
    else this.#debugCamera3d?.setKey(code, pressed)
  }

  toggleOutlines(): void {
    this.#_outlinesVisible = !this.#_outlinesVisible
    this.#emitToggle()
  }

  toggleLayoutOutlines(): void {
    this.#_layoutOutlinesVisible = !this.#_layoutOutlinesVisible
    this.#emitToggle()
  }

  toggleFollow(): void {
    this.#_followGameCamera = !this.#_followGameCamera
    this.camera.setFollow(this.#_followGameCamera)
    this.#emitToggle()
  }

  toggleGrid(): void {
    this.#_gridVisible = !this.#_gridVisible
    this.#emitToggle()
  }

  togglePause(): void {
    this.engine.setPaused(!this.engine.paused)
    this.#emitToggle()
  }

  togglePointerOverlay(): void {
    this.#_pointerOverlayVisible = !this.#_pointerOverlayVisible
    this.#emitToggle()
  }

  /** Current physics overlay flags (read-only). */
  get physicsFlags(): Readonly<PhysicsOverlayFlags> {
    return this.#_physicsFlags
  }

  /**
   * Highlight a node's bounds in the overlay, or pass `null` to clear. The
   * Scene panel calls this as the selection changes.
   */
  setHighlightedNode(node: Node2D | null): void {
    this.#highlightedNode = node
  }

  /** The node currently highlighted in the overlay, or null. */
  get highlightedNode(): Node2D | null {
    return this.#highlightedNode
  }

  /**
   * Highlight any node from the unified scene tree, routing to the 2D overlay
   * or the 3D gizmo pass by the node's {@link Node.kind}. Selecting one clears
   * the other, so only the picked node outlines. The Scene panel calls this.
   */
  setHighlighted(node: Node | null): void {
    if (node && node.kind === '3d') {
      this.#highlightedNode3d = node as Node3D
      this.#highlightedNode = null
    } else if (node && node.kind === '2d') {
      this.#highlightedNode = node as Node2D
      this.#highlightedNode3d = null
    } else {
      this.#highlightedNode = null
      this.#highlightedNode3d = null
    }
  }

  /**
   * Overlay accent color of the world a node hosts (its
   * `PhysicsWorldBehavior`), or null when the node hosts none. The Scene panel
   * uses it to tint a world boundary the same color as the overlay.
   */
  overlayAccentForNode(node: Node2D): string | null {
    for (const entry of this.engine.physicsWorlds) {
      if (entry.spaceNode === node) return this.#accentFor(entry.world)
    }
    return null
  }

  /** Registered worlds anchored in `stage`'s scene. */
  #worldsForStage(stage: Stage): RegisteredPhysicsWorld[] {
    const scene = stage.tree
    return this.engine.physicsWorlds.filter(
      (e) => (e.spaceNode?.scene ?? null) === scene,
    )
  }

  /** Stable overlay color for a world, assigned from the palette on demand. */
  #accentFor(world: PhysicsWorld): string {
    let c = this.#worldAccents.get(world)
    if (!c) {
      c = WORLD_ACCENTS[this.#worldAccents.size % WORLD_ACCENTS.length]
      this.#worldAccents.set(world, c)
    }
    return c
  }

  /** Flip one physics overlay layer on or off. */
  togglePhysics(key: keyof PhysicsOverlayFlags): void {
    this.#_physicsFlags[key] = !this.#_physicsFlags[key]
    const f = this.#_physicsFlags
    this.#_physicsAny = f.colliders || f.aabbs || f.contacts || f.velocities
    this.#emitToggle()
  }

  resetDebugCamera(): void {
    this.camera.reset()
    this.#debugCamera3d?.reset()
  }

  /**
   * Which camera renders `stage` this frame, the debug camera when the
   * active-debug-stage flag matches AND the debug camera is toggled on;
   * otherwise the stage's own game camera. Called by `Engine.frame()`.
   */
  activeCameraFor(stage: Stage): CameraView2D | null {
    return this.#_cameraActive &&
      this.#_debugSpace === '2d' &&
      stage === this.activeStage
      ? this.camera
      : stage.currentCamera2D
  }

  /** Whether the debug camera is engaged in 3D mode (fly-camera inspecting). */
  get camera3dActive(): boolean {
    return this.#_cameraActive && this.#_debugSpace === '3d'
  }

  /**
   * Which 3D camera renders `stage`'s world this frame: the 3D fly-camera when
   * the debug camera is active in 3D mode on the active stage, else the stage's
   * game `camera3d`. Mirrors {@link DebugController.activeCameraFor}.
   */
  activeCamera3dFor(stage: Stage): CameraView3D | null {
    return this.camera3dActive &&
      stage === this.activeStage &&
      this.#debugCamera3d
      ? this.#debugCamera3d
      : stage.currentCamera3D
  }

  /** Highlight a 3D node's bounds in the gizmo pass, or `null` to clear. */
  setHighlightedNode3d(node: Node3D | null): void {
    this.#highlightedNode3d = node
  }
  get highlightedNode3d(): Node3D | null {
    return this.#highlightedNode3d
  }

  snapshotStats(): DebugStatsSnapshot {
    const p = this.frameStats.percentiles()
    const fi = this.#frameIntervalStats.percentiles()
    const active = this.activeStage
    const counts = { static: 0, aboveStatic: 0, dynamic: 0, total: 0 }
    let aliveParticles = 0
    walkTree(active.tree.root, (node) => {
      if (node.kind !== '2d') return
      const n = node as Node2D
      counts.total++
      if (n.renderLayer === 'static') counts.static++
      else if (n.renderLayer === 'above-static') counts.aboveStatic++
      else counts.dynamic++
      aliveParticles += n.particleCount
    })
    // The active stage's "active" camera, debug or game depending on toggle.
    // Null when the stage has no current 2D camera (readouts fall back to zero).
    const cam = this.activeCameraFor(active)
    // Hover-pointer readout is primary-only (DebugController's own
    // pointermove listener is attached to engine.canvas). Active-pointer
    // sections follow the active stage's InputSystem instead.
    const ps = this.activeIsPrimary ? this.#_pointerScreen : null
    const pw = ps && cam ? cam.screenToWorld(ps.x, ps.y) : null
    const stageInput = active.input
    const activePointers: ActivePointerReadout[] = []
    if (stageInput) {
      for (const point of stageInput.pointers.values()) {
        activePointers.push({
          id: point.id,
          kind: point.kind,
          screen: { x: point.screen.x, y: point.screen.y },
          world: { x: point.world.x, y: point.world.y },
          capturedByNodeId: point.capturedBy?.id ?? null,
        })
      }
    }
    const gpu = { ...active.gpuStats }
    const physics = this.#snapshotPhysics(active)
    const world3d = this.#snapshotWorld3d(active)
    return {
      p50: p.p50,
      p95: p.p95,
      p99: p.p99,
      fps: fi.p50 > 0 ? 1 / fi.p50 : 0,
      max: p.max,
      count: p.count,
      nodeCounts: counts,
      gpu,
      backend: active.backend,
      cameraMode: this.#_cameraActive ? 'debug' : 'game',
      cameraFollowing: this.#_followGameCamera,
      viewport: cam ? { ...cam.viewport } : { x: 0, y: 0, width: 0, height: 0 },
      screenPxPerWorldUnit: cam?.screenPxPerWorldUnit() ?? 0,
      pointerScreen: ps ? { ...ps } : null,
      pointerWorld: pw,
      canvasCss: { ...active.renderer.cssSize },
      canvasDevice: { ...active.renderer.pixelSize },
      dpr: active.renderer.dpr,
      activePointers,
      touchSlopScreen: stageInput?.touchSlopScreen ?? 0,
      touchSlopWorld: stageInput?.touchSlopWorld ?? 0,
      aliveParticles,
      stages: this.#snapshotStageChips(),
      activeStageId: this.#stageIdOf(active),
      activeIsPrimary: this.activeIsPrimary,
      activeHasInput: stageInput !== null,
      physics,
      world3d,
      flyPointerLocked: this.#_flyPointerLocked,
      flySpeedMultiplier: this.#debugCamera3d?.speedMultiplier ?? 1,
    }
  }

  /** Tally 3D world + camera stats for a stage, or `null` when it has no 3D. */
  #snapshotWorld3d(stage: Stage): World3DReadout | null {
    // Only report 3D when the stage has real 3D content (or the 3D fly-cam is
    // engaged). `has3D` skips intrinsic nodes, so reading it never materializes
    // the lazy default 3D camera on a pure-2D stage.
    if (!stage.tree.has3D && !this.camera3dActive) return null
    let nodeCount = 0
    let meshCount = 0
    let rttSurfaces = 0
    let triangleCount = 0
    walkTree(stage.tree.root, (n) => {
      nodeCount++
      if (n instanceof MeshNode) {
        meshCount++
        const g = n.geometry
        if (g) triangleCount += g.indices.length / 3
      } else if (n instanceof Viewport2DNode) {
        rttSurfaces++
      }
    })
    const s = stage.render3dStats
    const cam = this.activeCamera3dFor(stage)
    // 3D content but no 3D camera yet: no camera readout to report.
    if (!cam) return null
    const eye = cam.eyePosition()
    return {
      nodeCount,
      meshCount,
      rttSurfaces,
      triangleCount,
      visible: s?.visible ?? 0,
      drawCalls: s?.draws ?? 0,
      cameraMode: this.camera3dActive ? 'debug' : 'game',
      camera: {
        position: { x: eye.x, y: eye.y, z: eye.z },
        projectionness: cam.projectionness,
        fovY: cam.fovY,
        near: cam.near,
        far: cam.far,
        aspect: cam.aspect,
        focalDistance: cam.focalDistance,
      },
    }
  }

  /** Tally physics stats for every world in a stage. */
  #snapshotPhysics(stage: Stage): PhysicsWorldReadout[] {
    const out: PhysicsWorldReadout[] = []
    const worlds = this.#worldsForStage(stage)
    for (let i = 0; i < worlds.length; i++) {
      const { world, label } = worlds[i]
      let sleeping = 0
      let staticCount = 0
      let dynamic = 0
      let kinematic = 0
      for (const b of world.bodies) {
        if (b.sleeping) sleeping++
        if (b.type === BodyType.Static) staticCount++
        else if (b.type === BodyType.Kinematic) kinematic++
        else dynamic++
      }
      out.push({
        id: `world-${i}`,
        label,
        accent: this.#accentFor(world),
        bodyCount: world.bodyCount,
        sleeping,
        static: staticCount,
        dynamic,
        kinematic,
        contactCount: world.contactCount,
        atRest: world.isAtRest(),
        gravity: { ...world.config.gravity },
      })
    }
    return out
  }

  #snapshotStageChips(): StageChip[] {
    const chips: StageChip[] = []
    const primary = this.engine.primaryStage
    chips.push({
      id: 'primary',
      label: primary.name ?? 'Primary',
      isActive: this.#_activeStage === null,
      isPrimary: true,
    })
    let idx = 1
    for (const stage of this.engine.stages) {
      chips.push({
        id: `stage-${idx}`,
        label: stage.name ?? `Stage ${idx}`,
        isActive: this.#_activeStage === stage,
        isPrimary: false,
      })
      idx++
    }
    return chips
  }

  #stageIdOf(stage: Stage): string {
    if (stage === this.engine.primaryStage) return 'primary'
    let idx = 1
    for (const s of this.engine.stages) {
      if (s === stage) return `stage-${idx}`
      idx++
    }
    return 'primary' // fallback; shouldn't happen
  }

  /**
   * Resolve a stage id (from `snapshotStats().stages[i].id`) back to the Stage
   * instance. Called by the HUD's chip strip on tap.
   */
  stageById(id: string): Stage | null {
    if (id === 'primary') return this.engine.primaryStage
    const m = /^stage-(\d+)$/.exec(id)
    if (!m) return null
    const target = Number(m[1])
    let idx = 1
    for (const s of this.engine.stages) {
      if (idx === target) return s
      idx++
    }
    return null
  }

  /**
   * Draw the stage-scoped overlays (grid, outlines, game-camera pip) over
   * `stage`. Called by `Engine.frame()` on whichever stage is currently the
   * active-debug-stage. Baseline transform: CSS px for consistent line widths.
   */
  drawOverlay(stage: Stage, activeCamera: CameraView2D, gfx: Gfx2D): void {
    const { renderer } = stage
    const dpr = renderer.dpr

    // Clip-mask viz FIRST while we still have a clean state, we install
    // a world→device_pixel base transform for the fillRect + setClipMask
    // so the mask UVs computed inside `GpuGfx.fillRect` line up with the
    // mask's worldRect. Only active on GPU stages under `'clip-mask'`
    // render mode.
    if (stage.getDebugRenderMode() === 'clip-mask' && this.#_inspectedMask) {
      this.#drawClipMaskOverlay(gfx, activeCamera, dpr)
    }

    // Reset blend so a lingering `lighter` from the last dynamic-layer
    // particle draw doesn't leak into debug lines. Base transform puts us
    // in CSS-px space (× dpr → device px in the actual draw call).
    gfx.setBlend('source-over')
    gfx.setAlpha(1)
    gfx.setBaseTransform(dpr, 0, 0, dpr, 0, 0)

    // The 2D screen grid draws only in 2D mode; 3D mode uses the ground grid in
    // `drawOverlay3D`, so the two never overlap.
    if (this.#_gridVisible && this.#_debugSpace === '2d') {
      drawGrid(gfx, activeCamera, renderer.cssSize.w, renderer.cssSize.h)
    }

    if (this.#_outlinesVisible) {
      drawNodeOutlines(gfx, stage, activeCamera)
    }

    if (this.#_layoutOutlinesVisible) {
      drawLayoutOutlines(gfx, stage, activeCamera)
    }

    if (this.#_physicsAny) {
      const alpha = this.engine.ticker.fixedAlpha
      for (const entry of this.#worldsForStage(stage)) {
        const space = entry.spaceNode?.transform.world ?? null
        drawPhysicsOverlay(
          gfx,
          entry.world,
          activeCamera,
          this.#_physicsFlags,
          space,
          alpha,
          this.#accentFor(entry.world),
          entry.label,
        )
      }
    }

    if (this.#highlightedNode && this.#highlightedNode.scene === stage.tree) {
      this.#drawNodeHighlight(gfx, activeCamera, this.#highlightedNode)
    }

    // Only meaningful when the debug camera is active, the pip shows the
    // stage's game camera rect in debug-camera space.
    const gameCam = stage.currentCamera2D
    if (this.#_cameraActive && gameCam) {
      this.#drawGameCameraRect(gfx, activeCamera, gameCam)
    }
  }

  /**
   * Collect 3D gizmos into `lines` for the stage's world, viewed through
   * `cam3d`. Called by `Stage.render` in the depth-tested 3D pass (between the
   * mesh pass and `resetToBaseline`). Grid + world axes ride the grid toggle
   * (`X`); mesh/quad bounds ride the outlines toggle (`O`); the highlighted
   * node draws as an always-visible overlay; the game camera frustum shows
   * while the 3D fly-camera is active.
   */
  drawOverlay3D(
    stage: Stage,
    cam3d: CameraView3D,
    lines: DebugLine3DRenderer,
  ): void {
    // The ground grid draws only in 3D mode, so it never coexists with the 2D
    // screen grid (which the 2D overlay draws in 2D mode). It follows the camera
    // (snapped to the grid) so it reads as infinite, and the three world axes
    // span far in both directions through the origin.
    if (this.#_gridVisible && this.#_debugSpace === '3d') {
      const eye = cam3d.eyePosition()
      lines.groundGrid(eye.x, eye.z, 1, 40, [1, 1, 1, 0.12])
      lines.originAxes(1000)
    }
    if (this.#_outlinesVisible) {
      walkTree(stage.tree.root, (n) => {
        if (n instanceof MeshNode) {
          const b = n.localBounds()
          if (b)
            pushObb(
              lines,
              b.min,
              b.max,
              n.worldMatrix,
              [0.4, 0.9, 1, 0.9],
              false,
            )
        } else if (n instanceof Viewport2DNode) {
          pushObb(
            lines,
            { x: -0.5, y: -0.5, z: 0 },
            { x: 0.5, y: 0.5, z: 0 },
            n.worldMatrix,
            [1, 0.7, 0.2, 0.9],
            false,
          )
        }
      })
    }
    // Wireframe render view: triangle edges over the shaded fill, depth-tested
    // so hidden edges are occluded (a clean "mesh view").
    if (this.#_renderMode === 'wireframe') {
      walkTree(stage.tree.root, (n) => {
        if (n instanceof MeshNode && n.geometry && n.visible) {
          pushWireframe(lines, n)
        } else if (n instanceof Viewport2DNode && n.visible) {
          // The viewport quad is two triangles; show its border + diagonal.
          pushQuadWireframe(lines, n.worldMatrix)
        }
      })
    }

    const hi = this.#highlightedNode3d
    if (hi) {
      const c: [number, number, number, number] = [1, 1, 0.3, 1]
      if (hi instanceof MeshNode) {
        const b = hi.localBounds()
        if (b) pushObb(lines, b.min, b.max, hi.worldMatrix, c, true)
      } else if (hi instanceof Viewport2DNode) {
        // Flat quad, matching the viewport surface (also used when a node inside
        // its embedded 2D scene is selected in the tree).
        pushObb(
          lines,
          { x: -0.5, y: -0.5, z: 0 },
          { x: 0.5, y: 0.5, z: 0 },
          hi.worldMatrix,
          c,
          true,
        )
      } else if (hi instanceof Light3D) {
        drawLightGizmo(lines, hi)
      } else {
        pushObb(
          lines,
          { x: -0.5, y: -0.5, z: -0.5 },
          { x: 0.5, y: 0.5, z: 0.5 },
          hi.worldMatrix,
          c,
          true,
        )
      }
    }
    if (this.camera3dActive && stage.currentCamera3D) {
      lines.frustum(stage.currentCamera3D.invViewProjection, [1, 0.8, 0.3, 0.8])
    }
  }

  /**
   * Paint the inspected clip mask over the frame as a translucent red fill,
   * clipped to the mask itself. Works by installing a world→device base
   * transform + `gfx.setClipMask(mask)` so `fillRect` uses local (world) coords
   * for the mask UVs, same coord system the mask's `worldRect` is in.
   */
  #drawClipMaskOverlay(gfx: Gfx2D, camera: CameraView2D, dpr: number): void {
    const mask = this.#_inspectedMask
    if (!mask) return
    const S = camera.getScreenAffine()
    gfx.setBlend('source-over')
    gfx.setAlpha(1)
    gfx.setBaseTransform(
      S.a * dpr,
      S.b * dpr,
      S.c * dpr,
      S.d * dpr,
      S.e * dpr,
      S.f * dpr,
    )
    gfx.setClipMask(mask)
    const wr = mask.worldRect
    gfx.fillRect(wr.x, wr.y, wr.width, wr.height, 'rgba(255, 80, 80, 0.4)')
    gfx.setClipMask(null)
  }

  /**
   * Draw the input overlay (pointer markers + ids) for a specific stage. Called
   * by `Stage.render()` for every stage that has an `InputSystem`, so
   * multi-touch is visible on whichever canvas the finger lands on. No-op if
   * the toggle is off or the stage has no input attached.
   */
  drawInputOverlay(stage: Stage, gfx: Gfx2D): void {
    if (!this.#_pointerOverlayVisible) return
    const input = stage.input
    if (!input) return
    const dpr = stage.renderer.dpr
    gfx.setBlend('source-over')
    gfx.setAlpha(1)
    gfx.setBaseTransform(dpr, 0, 0, dpr, 0, 0)
    drawPointerOverlay(gfx, input)
  }

  destroy(): void {
    this.#exitPointerLock()
    for (const fn of this.#disposeCallbacks) fn()
    this.#disposeCallbacks.length = 0
  }

  #emitToggle(): void {
    this.events.emit('toggle', {
      hud: this.hudVisible,
      camera: this.#_cameraActive,
      space: this.#_debugSpace,
      cameraMode: this.cameraMode,
      renderMode: this.#_renderMode,
      outlines: this.#_outlinesVisible,
      layoutOutlines: this.#_layoutOutlinesVisible,
      follow: this.#_followGameCamera,
      grid: this.#_gridVisible,
      paused: this.engine.paused,
      pointerOverlay: this.#_pointerOverlayVisible,
      physics: { ...this.#_physicsFlags },
      flyPointerLocked: this.#_flyPointerLocked,
    })
  }

  #onKeyDown(e: KeyboardEvent): void {
    const target = e.target
    if (
      target instanceof HTMLInputElement ||
      target instanceof HTMLTextAreaElement ||
      (target instanceof HTMLElement && target.isContentEditable)
    ) {
      return
    }
    // A focused <select> (e.g. the camera-mode dropdown that just engaged the
    // fly camera) would otherwise typeahead on WASD and change its own value.
    // While a debug camera is active, drop its focus so the key drives the
    // camera instead (the routing + preventDefault below then applies).
    if (target instanceof HTMLSelectElement) {
      if (!this.#_cameraActive) return
      target.blur()
    }
    // Hold-Shift sprints the 3D fly camera. Not routed as a control key and not
    // prevent-defaulted, so browser/OS Shift-combos are unaffected.
    if (
      this.camera3dActive &&
      (e.code === 'ShiftLeft' || e.code === 'ShiftRight')
    ) {
      this.#debugCamera3d?.setSprint(true)
      return
    }
    // Feed control keys to whichever debug camera the current space engages.
    if (this.#_cameraActive) {
      if (this.#_debugSpace === '2d' && DebugCamera.isControlKey(e.code)) {
        this.camera.setKey(e.code, true)
        e.preventDefault()
        return
      }
      if (
        this.#_debugSpace === '3d' &&
        this.#debugCamera3d &&
        DebugCamera3D.isControlKey(e.code)
      ) {
        this.#debugCamera3d.setKey(e.code, true)
        e.preventDefault()
        return
      }
    }
    switch (e.code) {
      case 'KeyV':
        // Toggle the 3D fly camera (from any mode back to active if already on).
        this.setCameraMode(
          this.cameraMode === 'debug-3d' ? 'active' : 'debug-3d',
        )
        e.preventDefault()
        return
      case 'KeyY':
        this.toggleHud()
        e.preventDefault()
        return
      case 'KeyC':
        // Toggle the 2D pan/zoom debug camera.
        this.setCameraMode(
          this.cameraMode === 'debug-2d' ? 'active' : 'debug-2d',
        )
        e.preventDefault()
        return
      case 'KeyO':
        this.toggleOutlines()
        e.preventDefault()
        return
      case 'KeyL':
        this.toggleLayoutOutlines()
        e.preventDefault()
        return
      case 'KeyG':
        this.toggleFollow()
        e.preventDefault()
        return
      case 'KeyX':
        this.toggleGrid()
        e.preventDefault()
        return
      case 'KeyP':
        this.togglePause()
        e.preventDefault()
        return
      case 'KeyT':
        this.togglePointerOverlay()
        e.preventDefault()
        return
      case 'KeyR':
        if (this.#_cameraActive) {
          this.resetDebugCamera()
          e.preventDefault()
        }
        return
      default:
        return
    }
  }

  #onKeyUp(e: KeyboardEvent): void {
    // Clear sprint before the active-guard so a Shift release that lands after
    // the camera toggled off is not swallowed (leaving sprint stuck on).
    if (e.code === 'ShiftLeft' || e.code === 'ShiftRight') {
      this.#debugCamera3d?.setSprint(false)
      return
    }
    if (!this.#_cameraActive) return
    if (this.#_debugSpace === '2d' && DebugCamera.isControlKey(e.code)) {
      this.camera.setKey(e.code, false)
    } else if (
      this.#_debugSpace === '3d' &&
      this.#debugCamera3d &&
      DebugCamera3D.isControlKey(e.code)
    ) {
      this.#debugCamera3d.setKey(e.code, false)
    }
  }

  #drawGameCameraRect(
    gfx: Gfx2D,
    activeCam: CameraView2D,
    gameCam: CameraView2D,
  ): void {
    // Game camera's world-space viewport rect (dashed) as seen through the
    // currently-active (debug) camera.
    const g = gameCam.viewport
    const pts = new Float32Array(8)
    for (let i = 0; i < 4; i++) {
      const cx = i === 0 || i === 3 ? g.x : g.x + g.width
      const cy = i < 2 ? g.y : g.y + g.height
      const s = activeCam.worldToScreen(cx, cy)
      pts[i * 2] = s.x
      pts[i * 2 + 1] = s.y
    }
    gfx.strokePolyline(pts, 4, {
      color: 'rgba(255, 215, 77, 0.9)',
      width: 1,
      dash: [6, 4],
      closed: true,
    })

    const anchor = activeCam.worldToScreen(g.x, g.y)
    gfx.fillText('game camera', anchor.x + 4, anchor.y + 12, {
      font: '11px monospace',
      color: 'rgba(255, 215, 77, 0.9)',
    })
  }

  /**
   * Outline a node's bounds (through its world transform) and label it with the
   * node id. Falls back to a small ring at the node origin when the node has no
   * `debugBounds`.
   */
  #drawNodeHighlight(gfx: Gfx2D, cam: CameraView2D, node: Node2D): void {
    // Bright line over a dark halo so the highlight reads on any background.
    const color = 'rgba(255, 255, 255, 0.98)'
    const halo = 'rgba(0, 0, 0, 0.85)'
    const m = node.transform.world
    const b = node.debugBounds
    if (!b) {
      const o = cam.worldToScreen(m.e, m.f)
      gfx.strokeCircle(o.x, o.y, 6, { color: halo, width: 4 })
      gfx.strokeCircle(o.x, o.y, 6, { color, width: 1.5 })
      this.#labelWithHalo(gfx, node.id, o.x + 9, o.y - 4, color)
      return
    }
    const pts = new Float32Array(8)
    const corners = [
      [b.x, b.y],
      [b.x + b.width, b.y],
      [b.x + b.width, b.y + b.height],
      [b.x, b.y + b.height],
    ]
    for (let i = 0; i < 4; i++) {
      const lx = corners[i][0]
      const ly = corners[i][1]
      const s = cam.worldToScreen(
        m.a * lx + m.c * ly + m.e,
        m.b * lx + m.d * ly + m.f,
      )
      pts[i * 2] = s.x
      pts[i * 2 + 1] = s.y
    }
    gfx.strokePolyline(pts, 4, { color: halo, width: 4, closed: true })
    gfx.strokePolyline(pts, 4, { color, width: 2, dash: [4, 3], closed: true })
    this.#labelWithHalo(gfx, node.id, pts[0] + 4, pts[1] - 4, color)
  }

  /** Draw label text on a dark backplate so it stays legible on any color. */
  #labelWithHalo(
    gfx: Gfx2D,
    text: string,
    x: number,
    y: number,
    color: string,
  ): void {
    // 11px monospace advance is ~6.6px; no measureText on Gfx2D, so approximate.
    const w = text.length * 6.6
    gfx.fillRect(x - 2, y - 10, w + 4, 14, 'rgba(0, 0, 0, 0.65)')
    gfx.fillText(text, x, y, { font: '11px monospace', color })
  }
}

// Overlay colors cycled across coexisting physics worlds. Distinct hues so two
// worlds on screen read apart at a glance.
const WORLD_ACCENTS = [
  'rgba(34, 211, 238, 1)', // cyan
  'rgba(232, 121, 249, 1)', // magenta
  'rgba(250, 204, 21, 1)', // amber
  'rgba(74, 222, 128, 1)', // green
  'rgba(248, 113, 113, 1)', // red
  'rgba(129, 140, 248, 1)', // indigo
]
