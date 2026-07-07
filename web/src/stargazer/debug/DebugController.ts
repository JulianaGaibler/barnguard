import { createEmitter, type Emitter } from '../events/Emitter'
import type { Engine } from '../engine/Engine'
import type { Camera } from '../camera/Camera'
import type { Stage } from '../render/Stage'
import type { InputSystem } from '../input/InputSystem'
import type { Gfx2D } from '../render/gfx/Gfx2D'
import type { BitmapMask } from '../assets/BitmapMask'
import { DebugCamera } from './DebugCamera'
import { FrameStats } from './FrameStats'
import { walkTree } from '../scene/traverse'
import { get, writable, type Readable } from 'svelte/store'
import type { Component } from 'svelte'
// Global debug UI styles, imported by the module that owns debug so we get
// the debug chrome CSS in the bundle exactly when debug code is used. Since
// this file is dynamically loaded only from `EngineHost` (which itself is
// tree-shakeable to whatever imports `createEngineHost`), the styles ride
// along automatically without polluting production bundles that never touch
// the debug controller.
import './ui/debug-ui.sass'

export interface DebugToggleState {
  hud: boolean
  camera: boolean
  outlines: boolean
  follow: boolean
  grid: boolean
  paused: boolean
  pointerOverlay: boolean
}

export interface ActivePointerReadout {
  id: number
  kind: 'touch' | 'mouse' | 'pen'
  screen: { x: number; y: number }
  world: { x: number; y: number }
  capturedByNodeId: string | null
}

/** One entry per attached stage, surfaced to the HUD for the chip strip. */
export interface StageChip {
  /** Stable identifier, `'primary'` or `'stage-{N}'`. */
  id: string
  /** Display label, `stage.name ?? \`Stage {N}`` (primary is always "Primary"). */
  label: string
  isActive: boolean
  isPrimary: boolean
}

export interface DebugGpuStatsReadout {
  drawCalls: number
  programSwitches: number
  textureBinds: number
  blendSwitches: number
  overflowWarns: number
  sdfInstances: number
  strokeInstances: number
  /** Effective MSAA sample count on the offscreen render target. `1` = off. */
  msaaSamples: number
}

export interface DebugStatsSnapshot {
  p50: number
  p95: number
  p99: number
  max: number
  count: number
  nodeCounts: {
    static: number
    aboveStatic: number
    dynamic: number
    total: number
  }
  /**
   * Per-frame GPU pipeline stats. Populated only when the active stage is
   * running the WebGL2 backend (`?renderer=gpu`); `null` under Canvas mode.
   */
  gpu: DebugGpuStatsReadout | null
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
  staticBakesTotal: number
  staticBakesPerSecond: number
  /** Current dynamic-resolution scale in `(0, 1]` (1 = native). */
  renderScale: number
  /** Live (unclosed) static-bake `ImageBitmap`s, a leak guard (should be ≤2). */
  activeBitmaps: number
  /** All currently-attached stages, in order (primary first). */
  stages: StageChip[]
  /** Id of the currently-active stage, matches one entry in `stages`. */
  activeStageId: string
  /** True when the active stage isn't the primary. HUD grays pointer sections. */
  activeIsPrimary: boolean
  /** True when the active stage has its own `InputSystem`. */
  activeHasInput: boolean
}

export interface DebugEvents {
  toggle: DebugToggleState
  /**
   * Emitted when `setActiveStage` (or auto-cleanup on detach) changes
   * selection.
   */
  stageChanged: { activeStageId: string }
}

export interface DebugControllerOptions {
  showHud?: boolean
  showOutlines?: boolean
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

interface StageMetrics {
  bakeStamps: number[]
  lastSeenTotalBakes: number
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
 */
export class DebugController {
  readonly enabled = true as const
  readonly camera: DebugCamera
  readonly frameStats: FrameStats
  readonly events: Emitter<DebugEvents>
  /** Read-only handle for HUD components that need scene / input access. */
  readonly engine: Engine

  /**
   * HUD visibility, backed by a Svelte writable so external components (like
   * the booth menu) can subscribe to changes without wiring the `toggle` event
   * by hand. `toggleHud()` / `setHudVisible()` both write here; the private
   * `_hudVisible` getter reads `get(store)` synchronously for backward-compat
   * with the existing plain-JS API.
   */
  private readonly hudVisibleStore = writable<boolean>(false)
  /** Reactive HUD visibility, subscribe from Svelte with `$`. */
  readonly hudVisible$: Readable<boolean> = this.hudVisibleStore
  private _cameraActive = false
  private _outlinesVisible = false
  private _followGameCamera = false
  private _gridVisible = false
  private _pointerOverlayVisible = false
  private _activeStage: Stage | null = null // null → primary

  private _pointerScreen: { x: number; y: number } | null = null

  /**
   * Currently-inspected clip mask, surfaced in the HUD via the `'clip-mask'`
   * render mode as a translucent red overlay. Set by the game session (or any
   * consumer holding the same `BitmapMask` used by `GridOverlayNode`). Null
   * when nothing is registered.
   */
  private _inspectedMask: BitmapMask | null = null

  /** Per-stage sliding window for the "static bakes/s" HUD row. */
  private readonly stageMetrics = new WeakMap<Stage, StageMetrics>()

  private readonly disposeCallbacks: Array<() => void> = []

  /**
   * Registered consumer panels, surfaced to `DebugHud.svelte` for
   * append-after-built-ins rendering. Backed by a Svelte writable so the HUD's
   * `#each` re-runs whenever a panel registers or unregisters. Sort-by-`order`
   * happens on read (see the `panels` getter).
   */
  private readonly panelsStore = writable<DebugPanelSpec[]>([])
  /**
   * Public readable view of the registered-panels list. Sorted ascending by
   * `order` (unset = `Infinity`, keeping ordered panels first and
   * registration-order for the rest).
   */
  readonly panels: Readable<DebugPanelSpec[]> = this.panelsStore

  constructor(engine: Engine, opts: DebugControllerOptions = {}) {
    this.engine = engine
    this.camera = new DebugCamera(engine.camera)
    this.frameStats = new FrameStats(300)
    this.events = createEmitter<DebugEvents>()

    this.hudVisibleStore.set(opts.showHud ?? false)
    this._outlinesVisible = opts.showOutlines ?? false
    this._gridVisible = opts.showGrid ?? false

    const onKeyDown = (e: KeyboardEvent): void => this.onKeyDown(e)
    const onKeyUp = (e: KeyboardEvent): void => this.onKeyUp(e)
    window.addEventListener('keydown', onKeyDown)
    window.addEventListener('keyup', onKeyUp)
    this.disposeCallbacks.push(() => {
      window.removeEventListener('keydown', onKeyDown)
      window.removeEventListener('keyup', onKeyUp)
    })

    // Pointer tracking, primary canvas only (secondaries have no input).
    const canvas = engine.canvas
    const onPointerMove = (e: PointerEvent): void => {
      const rect = canvas.getBoundingClientRect()
      this._pointerScreen = {
        x: e.clientX - rect.left,
        y: e.clientY - rect.top,
      }
    }
    const onPointerLeave = (): void => {
      this._pointerScreen = null
    }
    canvas.addEventListener('pointermove', onPointerMove)
    canvas.addEventListener('pointerleave', onPointerLeave)
    canvas.addEventListener('pointercancel', onPointerLeave)
    this.disposeCallbacks.push(() => {
      canvas.removeEventListener('pointermove', onPointerMove)
      canvas.removeEventListener('pointerleave', onPointerLeave)
      canvas.removeEventListener('pointercancel', onPointerLeave)
    })

    // Camera step runs BEFORE input reprojection so a WASD-panning debug
    // camera doesn't drag pointer state behind by one frame. Sized against
    // the active stage so pan feel is consistent regardless of canvas.
    const offBefore = engine.onBeforeFrame((dt) => {
      if (this._cameraActive) {
        const active = this.activeStage
        this.camera.setPixelSize(
          active.renderer.cssSize.w,
          active.renderer.cssSize.h,
        )
        this.camera.step(dt)
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
    })
    this.disposeCallbacks.push(offBefore, offFrame)
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
    this.panelsStore.update((list) => {
      const without = list.filter((p) => p.id !== spec.id)
      const next = [...without, spec]
      // Sort by `order` (undefined = Infinity so unordered panels append
      // in registration order after any explicitly-ordered ones).
      next.sort((a, b) => (a.order ?? Infinity) - (b.order ?? Infinity))
      return next
    })
    return () => {
      this.panelsStore.update((list) => list.filter((p) => p.id !== spec.id))
    }
  }

  get hudVisible(): boolean {
    return get(this.hudVisibleStore)
  }
  get cameraActive(): boolean {
    return this._cameraActive
  }
  get outlinesVisible(): boolean {
    return this._outlinesVisible
  }
  get followGameCamera(): boolean {
    return this._followGameCamera
  }
  get gridVisible(): boolean {
    return this._gridVisible
  }
  get pointerOverlayVisible(): boolean {
    return this._pointerOverlayVisible
  }
  get paused(): boolean {
    return this.engine.paused
  }
  get perfMarks(): boolean {
    return this.engine.perfMarks
  }
  setPerfMarks(enabled: boolean): void {
    this.engine.perfMarks = enabled
  }
  get inspectedMask(): BitmapMask | null {
    return this._inspectedMask
  }
  /**
   * Register the clip mask to visualise under the `'clip-mask'` render mode.
   * Session-side wiring: call once with the same `BitmapMask` passed to
   * `GridOverlayNode`. Passing `null` clears.
   */
  setInspectedMask(mask: BitmapMask | null): void {
    this._inspectedMask = mask
  }
  /**
   * The stage currently being inspected. Defaults to the primary; the HUD's
   * chip strip drives it via `setActiveStage`.
   */
  get activeStage(): Stage {
    return this._activeStage ?? this.engine.primaryStage
  }
  get activeIsPrimary(): boolean {
    return this._activeStage === null
  }

  /**
   * Point the HUD at a different stage. Pass `null` for the primary. Retargets
   * the debug camera so `follow` / `reset` behave against the new stage's game
   * camera.
   */
  setActiveStage(stage: Stage | null): void {
    if (this._activeStage === stage) return
    // Passing the primary stage explicitly normalises to null.
    if (stage === this.engine.primaryStage) stage = null
    this._activeStage = stage
    const active = this.activeStage
    this.camera.setGameCamera(active.camera)
    if (this._cameraActive) {
      this.camera.reset()
      this.camera.setPixelSize(
        active.renderer.cssSize.w,
        active.renderer.cssSize.h,
      )
    }
    this.events.emit('stageChanged', { activeStageId: this.stageIdOf(active) })
  }

  /**
   * Notify the controller that a secondary stage was detached. If it was the
   * active one, snap back to the primary. Called by `Engine.detachStage`.
   */
  onStageDetached(stage: Stage): void {
    if (this._activeStage !== stage) return
    this._activeStage = null
    this.camera.setGameCamera(this.engine.primaryStage.camera)
    if (this._cameraActive) {
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
    this.hudVisibleStore.set(visible)
    this.emitToggle()
  }

  toggleCamera(): void {
    this._cameraActive = !this._cameraActive
    if (this._cameraActive) {
      const active = this.activeStage
      // Make sure the debug camera is anchored to the current active stage
      // before we snap its viewport, matters when the user switched stages
      // while debug camera was off.
      this.camera.setGameCamera(active.camera)
      this.camera.reset()
      this.camera.setPixelSize(
        active.renderer.cssSize.w,
        active.renderer.cssSize.h,
      )
    } else {
      this.camera.clearKeys()
    }
    this.emitToggle()
  }

  toggleOutlines(): void {
    this._outlinesVisible = !this._outlinesVisible
    this.emitToggle()
  }

  toggleFollow(): void {
    this._followGameCamera = !this._followGameCamera
    this.camera.setFollow(this._followGameCamera)
    this.emitToggle()
  }

  toggleGrid(): void {
    this._gridVisible = !this._gridVisible
    this.emitToggle()
  }

  togglePause(): void {
    this.engine.setPaused(!this.engine.paused)
    this.emitToggle()
  }

  togglePointerOverlay(): void {
    this._pointerOverlayVisible = !this._pointerOverlayVisible
    this.emitToggle()
  }

  resetDebugCamera(): void {
    this.camera.reset()
  }

  /**
   * Which camera renders `stage` this frame, the debug camera when the
   * active-debug-stage flag matches AND the debug camera is toggled on;
   * otherwise the stage's own game camera. Called by `Engine.frame()`.
   */
  activeCameraFor(stage: Stage): Camera {
    return this._cameraActive && stage === this.activeStage
      ? this.camera
      : stage.camera
  }

  snapshotStats(): DebugStatsSnapshot {
    const p = this.frameStats.percentiles()
    const active = this.activeStage
    const counts = { static: 0, aboveStatic: 0, dynamic: 0, total: 0 }
    let aliveParticles = 0
    walkTree(active.scene.root, (n) => {
      counts.total++
      if (n.renderLayer === 'static') counts.static++
      else if (n.renderLayer === 'above-static') counts.aboveStatic++
      else counts.dynamic++
      aliveParticles += n.particleCount
    })
    // The active stage's "active" camera, debug or game depending on toggle.
    const cam = this.activeCameraFor(active)
    // Hover-pointer readout is primary-only (DebugController's own
    // pointermove listener is attached to engine.canvas). Active-pointer
    // sections follow the active stage's InputSystem instead.
    const ps = this.activeIsPrimary ? this._pointerScreen : null
    const pw = ps ? cam.screenToWorld(ps.x, ps.y) : null
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
    // `stage.gpuStats` is a public getter, returns null under Canvas.
    const gpu = active.gpuStats ? { ...active.gpuStats } : null
    return {
      p50: p.p50,
      p95: p.p95,
      p99: p.p99,
      max: p.max,
      count: p.count,
      nodeCounts: counts,
      gpu,
      cameraMode: this._cameraActive ? 'debug' : 'game',
      cameraFollowing: this._followGameCamera,
      viewport: { ...cam.viewport },
      screenPxPerWorldUnit: cam.screenPxPerWorldUnit(),
      pointerScreen: ps ? { ...ps } : null,
      pointerWorld: pw,
      canvasCss: { ...active.renderer.cssSize },
      canvasDevice: { ...active.renderer.pixelSize },
      dpr: active.renderer.dpr,
      activePointers,
      touchSlopScreen: stageInput?.touchSlopScreen ?? 0,
      touchSlopWorld: stageInput?.touchSlopWorld ?? 0,
      aliveParticles,
      staticBakesTotal: active.layers.totalBakes,
      staticBakesPerSecond: this.sampleBakeRate(active),
      renderScale: active.renderScale,
      activeBitmaps: active.layers.activeBitmaps,
      stages: this.snapshotStageChips(),
      activeStageId: this.stageIdOf(active),
      activeIsPrimary: this.activeIsPrimary,
      activeHasInput: stageInput !== null,
    }
  }

  /** Per-stage sliding window, bake stamps age out of a 1-second window. */
  private sampleBakeRate(stage: Stage): number {
    let m = this.stageMetrics.get(stage)
    if (!m) {
      m = { bakeStamps: [], lastSeenTotalBakes: 0 }
      this.stageMetrics.set(stage, m)
    }
    const total = stage.layers.totalBakes
    const delta = total - m.lastSeenTotalBakes
    m.lastSeenTotalBakes = total
    const now = performance.now()
    for (let i = 0; i < delta; i++) m.bakeStamps.push(now)
    const cutoff = now - 1000
    while (m.bakeStamps.length > 0 && m.bakeStamps[0] < cutoff) {
      m.bakeStamps.shift()
    }
    return m.bakeStamps.length
  }

  private snapshotStageChips(): StageChip[] {
    const chips: StageChip[] = []
    const primary = this.engine.primaryStage
    chips.push({
      id: 'primary',
      label: primary.name ?? 'Primary',
      isActive: this._activeStage === null,
      isPrimary: true,
    })
    let idx = 1
    for (const stage of this.engine.stages) {
      chips.push({
        id: `stage-${idx}`,
        label: stage.name ?? `Stage ${idx}`,
        isActive: this._activeStage === stage,
        isPrimary: false,
      })
      idx++
    }
    return chips
  }

  private stageIdOf(stage: Stage): string {
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
  drawOverlay(stage: Stage, activeCamera: Camera, gfx: Gfx2D): void {
    const { renderer } = stage
    const dpr = renderer.dpr

    // Clip-mask viz FIRST while we still have a clean state, we install
    // a world→device_pixel base transform for the fillRect + setClipMask
    // so the mask UVs computed inside `GpuGfx.fillRect` line up with the
    // mask's worldRect. Only active on GPU stages under `'clip-mask'`
    // render mode.
    if (stage.getDebugRenderMode() === 'clip-mask' && this._inspectedMask) {
      this.drawClipMaskOverlay(gfx, activeCamera, dpr)
    }

    // Reset blend so a lingering `lighter` from the last dynamic-layer
    // particle draw doesn't leak into debug lines. Base transform puts us
    // in CSS-px space (× dpr → device px in the actual draw call).
    gfx.setBlend('source-over')
    gfx.setAlpha(1)
    gfx.setBaseTransform(dpr, 0, 0, dpr, 0, 0)

    if (this._gridVisible) {
      this.drawGrid(gfx, activeCamera, renderer.cssSize.w, renderer.cssSize.h)
    }

    if (this._outlinesVisible) {
      this.drawNodeOutlines(gfx, stage, activeCamera)
    }

    // Only meaningful when the debug camera is active, the pip shows the
    // stage's game camera rect in debug-camera space.
    if (this._cameraActive) {
      this.drawGameCameraRect(gfx, activeCamera, stage.camera)
    }
  }

  /**
   * Paint the inspected clip mask over the frame as a translucent red fill,
   * clipped to the mask itself. Works by installing a world→device base
   * transform + `gfx.setClipMask(mask)` so `fillRect` uses local (world) coords
   * for the mask UVs, same coord system the mask's `worldRect` is in.
   */
  private drawClipMaskOverlay(gfx: Gfx2D, camera: Camera, dpr: number): void {
    const mask = this._inspectedMask
    if (!mask) return
    const cam = camera.getScreenTransform()
    const s = cam.scale * dpr
    gfx.setBlend('source-over')
    gfx.setAlpha(1)
    gfx.setBaseTransform(s, 0, 0, s, cam.offsetX * dpr, cam.offsetY * dpr)
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
    if (!this._pointerOverlayVisible) return
    const input = stage.input
    if (!input) return
    const dpr = stage.renderer.dpr
    gfx.setBlend('source-over')
    gfx.setAlpha(1)
    gfx.setBaseTransform(dpr, 0, 0, dpr, 0, 0)
    this.drawPointerOverlay(gfx, input)
  }

  destroy(): void {
    for (const fn of this.disposeCallbacks) fn()
    this.disposeCallbacks.length = 0
  }

  private emitToggle(): void {
    this.events.emit('toggle', {
      hud: this.hudVisible,
      camera: this._cameraActive,
      outlines: this._outlinesVisible,
      follow: this._followGameCamera,
      grid: this._gridVisible,
      paused: this.engine.paused,
      pointerOverlay: this._pointerOverlayVisible,
    })
  }

  private onKeyDown(e: KeyboardEvent): void {
    const target = e.target
    if (
      target instanceof HTMLInputElement ||
      target instanceof HTMLTextAreaElement ||
      target instanceof HTMLSelectElement ||
      (target instanceof HTMLElement && target.isContentEditable)
    ) {
      return
    }
    // Debug camera key state (WASD Q E), feed the DebugCamera when it's active.
    if (this._cameraActive && DebugCamera.isControlKey(e.code)) {
      this.camera.setKey(e.code, true)
      e.preventDefault()
      return
    }
    switch (e.code) {
      case 'KeyY':
        this.toggleHud()
        e.preventDefault()
        return
      case 'KeyC':
        this.toggleCamera()
        e.preventDefault()
        return
      case 'KeyO':
        this.toggleOutlines()
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
        if (this._cameraActive) {
          this.resetDebugCamera()
          e.preventDefault()
        }
        return
      default:
        return
    }
  }

  private onKeyUp(e: KeyboardEvent): void {
    if (this._cameraActive && DebugCamera.isControlKey(e.code)) {
      this.camera.setKey(e.code, false)
    }
  }

  private drawNodeOutlines(gfx: Gfx2D, stage: Stage, cam: Camera): void {
    const strokeStyle = { color: 'rgba(96, 165, 250, 0.6)', width: 1 }
    const rectPts = new Float32Array(8)

    walkTree(stage.scene.root, (node) => {
      if (!node.debugVisible || !node.visible) return
      const w = node.transform.world
      // Pivot cross at node origin.
      const px = w.e
      const py = w.f
      const screenOrigin = cam.worldToScreen(px, py)
      const cross = 4
      gfx.strokeLine(
        screenOrigin.x - cross,
        screenOrigin.y,
        screenOrigin.x + cross,
        screenOrigin.y,
        strokeStyle,
      )
      gfx.strokeLine(
        screenOrigin.x,
        screenOrigin.y - cross,
        screenOrigin.x,
        screenOrigin.y + cross,
        strokeStyle,
      )

      // OBB from debugBounds corners → world → screen. See scene/SceneNode.ts
      // for the debug-bounds convention (local AABB, projected through world).
      const b = node.debugBounds
      if (!b) return
      const corners: Array<[number, number]> = [
        [b.x, b.y],
        [b.x + b.width, b.y],
        [b.x + b.width, b.y + b.height],
        [b.x, b.y + b.height],
      ]
      for (let i = 0; i < 4; i++) {
        const lx = corners[i][0]
        const ly = corners[i][1]
        const wx = w.a * lx + w.c * ly + w.e
        const wy = w.b * lx + w.d * ly + w.f
        const s = cam.worldToScreen(wx, wy)
        rectPts[i * 2] = s.x
        rectPts[i * 2 + 1] = s.y
      }
      gfx.strokePolyline(rectPts, 4, { ...strokeStyle, closed: true })
    })
  }

  private drawGrid(
    gfx: Gfx2D,
    cam: Camera,
    canvasW: number,
    canvasH: number,
  ): void {
    const vp = cam.viewport
    if (vp.width <= 0 || vp.height <= 0) return

    const step = niceGridStep(vp.width)
    const subStep = step / 5

    // World range covering the entire visible canvas (includes letterbox
    // beyond the camera's fitted viewport).
    const originTL = cam.screenToWorld(0, 0)
    const originBR = cam.screenToWorld(canvasW, canvasH)
    const xLo = Math.min(originTL.x, originBR.x)
    const xHi = Math.max(originTL.x, originBR.x)
    const yLo = Math.min(originTL.y, originBR.y)
    const yHi = Math.max(originTL.y, originBR.y)

    const minor = { color: 'rgba(255, 255, 255, 0.05)', width: 1 }
    const major = { color: 'rgba(96, 165, 250, 0.25)', width: 1 }
    const axis = { color: 'rgba(255, 215, 77, 0.5)', width: 1 }

    for (let x = Math.ceil(xLo / subStep) * subStep; x <= xHi; x += subStep) {
      const sx = cam.worldToScreen(x, 0).x
      gfx.strokeLine(sx, 0, sx, canvasH, minor)
    }
    for (let y = Math.ceil(yLo / subStep) * subStep; y <= yHi; y += subStep) {
      const sy = cam.worldToScreen(0, y).y
      gfx.strokeLine(0, sy, canvasW, sy, minor)
    }
    for (let x = Math.ceil(xLo / step) * step; x <= xHi; x += step) {
      const sx = cam.worldToScreen(x, 0).x
      gfx.strokeLine(sx, 0, sx, canvasH, major)
    }
    for (let y = Math.ceil(yLo / step) * step; y <= yHi; y += step) {
      const sy = cam.worldToScreen(0, y).y
      gfx.strokeLine(0, sy, canvasW, sy, major)
    }
    if (0 >= xLo && 0 <= xHi) {
      const sx = cam.worldToScreen(0, 0).x
      gfx.strokeLine(sx, 0, sx, canvasH, axis)
    }
    if (0 >= yLo && 0 <= yHi) {
      const sy = cam.worldToScreen(0, 0).y
      gfx.strokeLine(0, sy, canvasW, sy, axis)
    }

    // Labels on major lines. Canvas-mode only (GPU backend has no
    // fillText; duck-typed check).
    const canText = 'fillText' in gfx
    if (canText) {
      const yAxisScreenX = cam.worldToScreen(0, 0).x
      const xAxisScreenY = cam.worldToScreen(0, 0).y
      const labelX = Math.max(2, Math.min(yAxisScreenX + 2, canvasW - 40))
      const labelY = Math.max(0, Math.min(xAxisScreenY + 2, canvasH - 14))
      const labelStyle = {
        font: '10px monospace',
        align: 'left' as const,
        baseline: 'top' as const,
        color: 'rgba(255, 255, 255, 0.55)',
      }
      const gfxText = gfx as unknown as {
        fillText(
          text: string,
          x: number,
          y: number,
          opts?: typeof labelStyle,
        ): void
      }
      for (let x = Math.ceil(xLo / step) * step; x <= xHi; x += step) {
        const sx = cam.worldToScreen(x, 0).x
        gfxText.fillText(formatCoord(x), sx + 2, labelY, labelStyle)
      }
      for (let y = Math.ceil(yLo / step) * step; y <= yHi; y += step) {
        const sy = cam.worldToScreen(0, y).y
        if (Math.abs(y) < 1e-6) continue
        gfxText.fillText(formatCoord(y), labelX, sy + 2, labelStyle)
      }
    }
  }

  /**
   * Draw a marker at each active pointer's screen position with its pointer ID
   * and kind. Draws on the canvas whose `InputSystem` owns the pointers, so a
   * finger on the secondary card gets markers on the secondary canvas.
   */
  private drawPointerOverlay(gfx: Gfx2D, input: InputSystem): void {
    const pointers = input.pointers
    if (pointers.size === 0) return

    const slop = input.touchSlopScreen
    const radius = Math.max(20, slop)
    const canText = 'fillText' in gfx
    const gfxText = canText
      ? (gfx as unknown as {
          fillText(
            text: string,
            x: number,
            y: number,
            opts?: {
              font?: string
              align?: CanvasTextAlign
              baseline?: CanvasTextBaseline
              color?: string
            },
          ): void
        })
      : null

    for (const p of pointers.values()) {
      const idx = Math.abs(p.id) % POINTER_PALETTE.length
      const [stroke, fill] = POINTER_PALETTE[idx]
      gfx.fillCircle(p.screen.x, p.screen.y, radius, fill)
      gfx.strokeCircle(p.screen.x, p.screen.y, radius, {
        color: stroke,
        width: 2,
      })
      gfx.fillCircle(p.screen.x, p.screen.y, 3, stroke)

      if (gfxText) {
        const label = `#${p.id} ${p.kind}`
        const tx = p.screen.x + radius + 6
        const ty = p.screen.y
        gfxText.fillText(label, tx, ty, {
          font: '11px "SF Mono", "Monaco", "Roboto Mono", "Courier New", monospace',
          align: 'left',
          baseline: 'middle',
          color: '#fff',
        })
      }
    }
  }

  private drawGameCameraRect(
    gfx: Gfx2D,
    activeCam: Camera,
    gameCam: Camera,
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

    if ('fillText' in gfx) {
      const gfxText = gfx as unknown as {
        fillText(
          text: string,
          x: number,
          y: number,
          opts?: {
            font?: string
            color?: string
          },
        ): void
      }
      const anchor = activeCam.worldToScreen(g.x, g.y)
      gfxText.fillText('game camera', anchor.x + 4, anchor.y + 12, {
        font: '10px monospace',
        color: 'rgba(255, 215, 77, 0.9)',
      })
    }
  }
}

/**
 * Palette rotated by `pointerId % length` for the pointer overlay. Each entry
 * is a `[stroke, fill]` pair so we don't recompute alpha strings per frame.
 */
const POINTER_PALETTE: ReadonlyArray<readonly [string, string]> = [
  ['#60a5fa', 'rgba(96, 165, 250, 0.2)'],
  ['#c084fc', 'rgba(192, 132, 252, 0.2)'],
  ['#4ade80', 'rgba(74, 222, 128, 0.2)'],
  ['#fbbf24', 'rgba(251, 191, 36, 0.2)'],
  ['#f87171', 'rgba(248, 113, 113, 0.2)'],
  ['#fb923c', 'rgba(251, 146, 60, 0.2)'],
]

/**
 * Pick a nice round grid step so ~8-12 major lines fit across `range` world
 * units. Snaps to 1/2/5 × 10ⁿ.
 */
function niceGridStep(range: number): number {
  if (!Number.isFinite(range) || range <= 0) return 1
  const raw = range / 10
  const magnitude = Math.pow(10, Math.floor(Math.log10(raw)))
  const normalized = raw / magnitude
  let nice: number
  if (normalized < 1.5) nice = 1
  else if (normalized < 3) nice = 2
  else if (normalized < 7) nice = 5
  else nice = 10
  return nice * magnitude
}

/**
 * Compact numeric label, trims trailing fractional zeros (but never integer
 * digits) and avoids scientific notation for typical world-coord magnitudes.
 */
function formatCoord(n: number): string {
  if (Math.abs(n) < 1e-9) return '0'
  const abs = Math.abs(n)
  const decimals = abs >= 100 ? 0 : abs >= 10 ? 1 : 2
  const s = n.toFixed(decimals)
  if (s.indexOf('.') === -1) return s
  return s.replace(/0+$/, '').replace(/\.$/, '')
}
