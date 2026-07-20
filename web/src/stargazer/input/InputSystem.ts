import type { Vec2 } from '../math/Vec2'
import type { Engine } from '../engine/Engine'
import type { Camera } from '../camera/Camera'
import type { Stage } from '../render/Stage'
import type { SceneNode } from '../scene/SceneNode'
import type {
  PointerEvent2D,
  PointerPhase,
  PointerStateSnapshot,
} from './PointerState'
import { findHitNode } from './hit'

/** Internal mutable pointer record. Structurally satisfies PointerStateSnapshot. */
interface PointerRecord {
  id: number
  kind: 'touch' | 'mouse' | 'pen'
  screen: Vec2
  world: Vec2
  startedAtMs: number
  capturedBy: SceneNode | null
  /** Un-subscribes from `capturedBy.events.on('destroy', …)`. */
  destroyUnsub: (() => void) | null
  /** True if a native `pointermove` was dispatched for this pointer this frame. */
  nativeMoveThisFrame: boolean
}

/** Screen-space touch slop in CSS pixels. Recomputed to world units on demand. */
const DEFAULT_TOUCH_SLOP_SCREEN_PX = 30

/**
 * Multi-touch input for one interactive `Stage`, reached as `stage.input` (or
 * `engine.input` for the primary stage). Wire pointer handling on a node
 * (`shape.hitEnabled = true`, `shape.onPointerDown = ...`) rather than going
 * through this class directly; see the input guide. `pointers` and the touch
 * slop settings are the parts most game code touches here.
 *
 * For engine developers: this owns the DOM `PointerEvent` listeners on the
 * stage's canvas (with `setPointerCapture` so a finger sliding off the physical
 * bezel keeps producing events), hit-walks this stage's scene on `down` to
 * capture the topmost `hitEnabled` node, and re-projects every active pointer's
 * `world` at the start of each frame, emitting a synthetic `pointerMove` when a
 * camera animation has drifted the world coord under a still finger. It emits
 * `pointerDown/Move/Up/Cancel` on `stage.events`; the primary stage's events
 * are also forwarded to `engine.events` by the `Engine` constructor, but
 * secondaries stay isolated.
 *
 * @category Input
 * @example
 *   for (const p of engine.input.pointers.values()) {
 *     if (p.capturedBy === shape) drawDebugDot(p.world)
 *   }
 */
export class InputSystem {
  /** All currently-down pointers, keyed by browser pointerId. */
  readonly pointers: ReadonlyMap<number, PointerStateSnapshot>

  readonly #recordsMap = new Map<number, PointerRecord>()
  readonly #stage: Stage
  readonly #canvas: HTMLCanvasElement
  readonly #engine: Engine
  readonly #disposeCallbacks: Array<() => void> = []
  #disposed = false
  #touchSlopScreenPx = DEFAULT_TOUCH_SLOP_SCREEN_PX

  constructor(stage: Stage, engine: Engine) {
    this.#stage = stage
    this.#canvas = stage.canvas
    this.#engine = engine
    this.pointers = this.#recordsMap as ReadonlyMap<
      number,
      PointerStateSnapshot
    >
    this.#attachListeners()
  }

  /** Screen-space slop in CSS px. Default 30 (roughly a fingertip). */
  get touchSlopScreen(): number {
    return this.#touchSlopScreenPx
  }
  setTouchSlopScreen(cssPx: number): void {
    this.#touchSlopScreenPx = Math.max(0, cssPx)
  }

  /** Slop converted to world units using the ACTIVE camera's uniform scale. */
  get touchSlopWorld(): number {
    const scale = this.#getActiveCamera().screenPxPerWorldUnit()
    return scale > 0 ? this.#touchSlopScreenPx / scale : 0
  }

  /**
   * Camera used for world↔screen conversion. When the debug HUD has picked this
   * stage AND the debug camera is toggled on, that camera drives; else the
   * stage's own game camera. Recomputed on every access so pan-under-
   * a-still-finger stays glued during debug camera motion.
   */
  #getActiveCamera(): Camera {
    return (
      this.#engine.debug?.activeCameraFor(this.#stage) ?? this.#stage.camera
    )
  }

  /**
   * Called by `Engine.frame()` at the start of every render tick, AFTER any
   * `onBeforeFrame` handlers have updated the active camera. Re-projects every
   * pointer's world coord and emits a synthetic `pointerMove` for any pointer
   * whose world coord drifted without a native event this frame.
   */
  beforeFrame(): void {
    if (this.#disposed || this.#recordsMap.size === 0) return
    const cam = this.#getActiveCamera()
    const scratch = { x: 0, y: 0 }
    for (const record of this.#recordsMap.values()) {
      cam.screenToWorld(record.screen.x, record.screen.y, scratch)
      const dx = scratch.x - record.world.x
      const dy = scratch.y - record.world.y
      const drifted = Math.abs(dx) > 1e-4 || Math.abs(dy) > 1e-4
      record.world.x = scratch.x
      record.world.y = scratch.y
      if (drifted && !record.nativeMoveThisFrame) {
        this.#dispatchMove(record, dx, dy, 'synthetic')
      }
      record.nativeMoveThisFrame = false
    }
  }

  /** Force-release a pointer's node capture (does NOT dispatch cancel). */
  releaseCapture(pointerId: number): void {
    const record = this.#recordsMap.get(pointerId)
    if (!record) return
    if (record.destroyUnsub) {
      record.destroyUnsub()
      record.destroyUnsub = null
    }
    record.capturedBy = null
  }

  destroy(): void {
    if (this.#disposed) return
    this.#disposed = true
    for (const record of this.#recordsMap.values()) {
      if (record.destroyUnsub) record.destroyUnsub()
    }
    this.#recordsMap.clear()
    for (const fn of this.#disposeCallbacks) fn()
    this.#disposeCallbacks.length = 0
  }

  #attachListeners(): void {
    const canvas = this.#canvas
    const onDown = (e: PointerEvent): void => this.#handleDown(e)
    const onMove = (e: PointerEvent): void => this.#handleMove(e)
    const onUp = (e: PointerEvent): void => this.#handleUp(e)
    const onCancel = (e: PointerEvent): void => this.#handleCancel(e)
    const onLost = (e: PointerEvent): void => this.#handleLostCapture(e)
    // `pointerleave` on the canvas fires when a finger drifts off the
    // element without a `up`. Because we call setPointerCapture on down, the
    // browser should keep routing events back to us and this listener won't
    // fire mid-drag, but if the browser DOES release capture for some
    // reason (e.g. the element is removed), we get `lostpointercapture`.
    canvas.addEventListener('pointerdown', onDown)
    canvas.addEventListener('pointermove', onMove)
    canvas.addEventListener('pointerup', onUp)
    canvas.addEventListener('pointercancel', onCancel)
    canvas.addEventListener('lostpointercapture', onLost)
    // Prevent the browser context menu on long-press / right-click so the
    // kiosk can't be interrupted by a system menu appearing over the game.
    const onContextMenu = (e: MouseEvent): void => e.preventDefault()
    canvas.addEventListener('contextmenu', onContextMenu)
    this.#disposeCallbacks.push(() => {
      canvas.removeEventListener('pointerdown', onDown)
      canvas.removeEventListener('pointermove', onMove)
      canvas.removeEventListener('pointerup', onUp)
      canvas.removeEventListener('pointercancel', onCancel)
      canvas.removeEventListener('lostpointercapture', onLost)
      canvas.removeEventListener('contextmenu', onContextMenu)
    })
  }

  #toCanvasCss(e: PointerEvent): Vec2 {
    const rect = this.#canvas.getBoundingClientRect()
    return {
      x: e.clientX - rect.left,
      y: e.clientY - rect.top,
    }
  }

  #pointerKind(e: PointerEvent): 'touch' | 'mouse' | 'pen' {
    if (e.pointerType === 'touch') return 'touch'
    if (e.pointerType === 'pen') return 'pen'
    return 'mouse'
  }

  #handleDown(e: PointerEvent): void {
    if (this.#disposed) return
    // Prevent focus stealing / accidental text selection outside the canvas.
    e.preventDefault()

    const screen = this.#toCanvasCss(e)
    const world = this.#getActiveCamera().screenToWorld(screen.x, screen.y)
    const record: PointerRecord = {
      id: e.pointerId,
      kind: this.#pointerKind(e),
      screen: { ...screen },
      world: { ...world },
      startedAtMs: performance.now(),
      capturedBy: null,
      destroyUnsub: null,
      nativeMoveThisFrame: false,
    }
    this.#recordsMap.set(e.pointerId, record)

    // DOM-level capture, browser routes all subsequent events for this
    // pointerId to the canvas until we (or the browser) release it.
    try {
      this.#canvas.setPointerCapture(e.pointerId)
    } catch {
      // Some browsers throw for touch pointers under specific conditions;
      // we fall back gracefully, global window listeners aren't wired
      // (would require broader refactor), but capture-less operation still
      // works if the pointer stays over the canvas.
    }

    // Node-level hit-test in world coords through the ACTIVE camera on the
    // owning stage's scene.
    const hit = findHitNode(
      this.#stage.scene.root,
      world.x,
      world.y,
      this.touchSlopWorld,
    )
    if (hit) {
      record.capturedBy = hit
      // If the node dies while capturing, synthesise cancel + release.
      record.destroyUnsub = hit.events.on('destroy', () => {
        this.#dispatchCancel(record.id, 'synthetic')
      })
      hit.onPointerDown?.(this.#makeEvent(record, 0, 0, 'down', 'native'))
    }
    this.#stage.events.emit(
      'pointerDown',
      this.#makeEvent(record, 0, 0, 'down', 'native'),
    )
  }

  #handleMove(e: PointerEvent): void {
    if (this.#disposed) return
    const record = this.#recordsMap.get(e.pointerId)
    if (!record) return
    const screen = this.#toCanvasCss(e)
    record.screen.x = screen.x
    record.screen.y = screen.y
    const world = this.#getActiveCamera().screenToWorld(screen.x, screen.y)
    const dx = world.x - record.world.x
    const dy = world.y - record.world.y
    record.world.x = world.x
    record.world.y = world.y
    record.nativeMoveThisFrame = true
    this.#dispatchMove(record, dx, dy, 'native')
  }

  #dispatchMove(
    record: PointerRecord,
    dx: number,
    dy: number,
    source: 'native' | 'synthetic',
  ): void {
    const ev = this.#makeEvent(record, dx, dy, 'move', source)
    if (record.capturedBy && !record.capturedBy.isDestroyed) {
      record.capturedBy.onPointerMove?.(ev)
    }
    this.#stage.events.emit('pointerMove', ev)
  }

  #handleUp(e: PointerEvent): void {
    if (this.#disposed) return
    const record = this.#recordsMap.get(e.pointerId)
    if (!record) return
    const screen = this.#toCanvasCss(e)
    record.screen.x = screen.x
    record.screen.y = screen.y
    const world = this.#getActiveCamera().screenToWorld(screen.x, screen.y)
    const dx = world.x - record.world.x
    const dy = world.y - record.world.y
    record.world.x = world.x
    record.world.y = world.y

    const ev = this.#makeEvent(record, dx, dy, 'up', 'native')
    if (record.capturedBy && !record.capturedBy.isDestroyed) {
      record.capturedBy.onPointerUp?.(ev)
    }
    this.#stage.events.emit('pointerUp', ev)

    this.#cleanupRecord(e.pointerId)
  }

  #handleCancel(e: PointerEvent): void {
    if (this.#disposed) return
    this.#dispatchCancel(e.pointerId, 'native')
  }

  #handleLostCapture(e: PointerEvent): void {
    if (this.#disposed) return
    if (!this.#recordsMap.has(e.pointerId)) return
    // Browser released capture unexpectedly, treat as cancel.
    this.#dispatchCancel(e.pointerId, 'native')
  }

  #dispatchCancel(pointerId: number, source: 'native' | 'synthetic'): void {
    const record = this.#recordsMap.get(pointerId)
    if (!record) return
    const ev = this.#makeEvent(record, 0, 0, 'cancel', source)
    if (record.capturedBy && !record.capturedBy.isDestroyed) {
      record.capturedBy.onPointerCancel?.(ev)
    }
    this.#stage.events.emit('pointerCancel', ev)
    this.#cleanupRecord(pointerId)
  }

  #cleanupRecord(pointerId: number): void {
    const record = this.#recordsMap.get(pointerId)
    if (!record) return
    if (record.destroyUnsub) record.destroyUnsub()
    if (this.#canvas.hasPointerCapture?.(pointerId)) {
      try {
        this.#canvas.releasePointerCapture(pointerId)
      } catch {
        // ignore, pointer may already be released by the browser
      }
    }
    this.#recordsMap.delete(pointerId)
  }

  #makeEvent(
    record: PointerRecord,
    dx: number,
    dy: number,
    phase: PointerPhase,
    source: 'native' | 'synthetic',
  ): PointerEvent2D {
    return {
      pointer: {
        id: record.id,
        kind: record.kind,
        screen: { x: record.screen.x, y: record.screen.y },
        world: { x: record.world.x, y: record.world.y },
        startedAtMs: record.startedAtMs,
        capturedBy: record.capturedBy,
      },
      delta: { x: dx, y: dy },
      phase,
      source,
      stage: this.#stage,
    }
  }
}
