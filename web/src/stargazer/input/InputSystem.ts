import type { Vec2 } from '../math/Vec2'
import type { Engine } from '../engine/Engine'
import type { CameraView2D } from '../camera/CameraView2D'
import type { CameraView3D } from '../camera/CameraView3D'
import type { Stage } from '../render/Stage'
import type {
  PointerEvent2D,
  PointerPhase,
  PointerStateSnapshot,
  PointerTarget,
} from './PointerState'
import { findHitNode } from './hit'
import { raycastWorld3D } from '../scene/raycast3d'
import type { Node2D } from '../scene/Node2D'
import { layerOf, viewFor } from '../scene/viewFor'
import { setWorldToLocalCheck } from '../scene/worldSpaceGuard'

/** Internal mutable pointer record. Structurally satisfies PointerStateSnapshot. */
interface PointerRecord {
  id: number
  kind: 'touch' | 'mouse' | 'pen'
  screen: Vec2
  /** The position in the stage camera's world, for stage-level events. */
  world: Vec2
  /**
   * The position in the world of the captured node's view, for that node's own
   * events. Equal to `world` unless the node sits under a layer with a space of
   * its own.
   */
  nodeWorld: Vec2
  startedAtMs: number
  capturedBy: PointerTarget | null
  /** Un-subscribes from `capturedBy.events.on('destroy', …)`. */
  destroyUnsub: (() => void) | null
  /** True if a native `pointermove` was dispatched for this pointer this frame. */
  nativeMoveThisFrame: boolean
}

/** Screen-space touch slop in CSS pixels. Recomputed to world units on demand. */
const DEFAULT_TOUCH_SLOP_SCREEN_PX = 30

/**
 * The camera-space position the last stage-level pointer event carried, which
 * the development check compares against.
 */
let lastStageWorldX = NaN
let lastStageWorldY = NaN
const warnedMisuse = new WeakSet<Node2D>()
const LOCAL_SCRATCH: Vec2 = { x: 0, y: 0 }

/**
 * Development check for a footgun: a stage-level event's `pointer.world` is in
 * the camera's space, so passing it to `worldToLocal` of a node under a layer
 * with a space of its own puts the node in the wrong place. Warns once per
 * node.
 */
function warnOnCameraWorldMisuse(node: Node2D, x: number, y: number): void {
  if (x !== lastStageWorldX || y !== lastStageWorldY) return
  if (warnedMisuse.has(node)) return
  const layer = layerOf(node)
  if (!layer) return
  warnedMisuse.add(node)
  console.warn(
    `A stage event's pointer.world was passed to ${node.id}.worldToLocal, but ${node.id} is placed by layer ${layer.id}, not the camera. Use event.localTo(${node.id}) to get the position in its space.`,
  )
}

/**
 * Multi-touch input for one interactive `Stage`, reached as `stage.input` (or
 * `engine.input` for the primary stage). Wire pointer handling on a node
 * (`shape.hitEnabled = true`, `shape.onPointerDown = ...`) rather than going
 * through this class directly, see the input guide. `pointers` and the touch
 * slop settings are the parts most game code touches here.
 *
 * For engine developers: this owns the DOM `PointerEvent` listeners on the
 * stage's canvas (with `setPointerCapture` so a finger sliding off the physical
 * bezel keeps producing events), hit-walks this stage's scene on `down` to
 * capture the topmost `hitEnabled` node, and re-projects every active pointer's
 * `world` at the start of each frame, emitting a synthetic `pointerMove` when a
 * camera animation has drifted the world coord under a still finger. A node
 * under a layer with a space of its own is hit-tested and receives positions in
 * that layer's space, while stage-level events keep the camera's. It emits
 * `pointerDown/Move/Up/Cancel` on `stage.events`. The primary stage's events
 * are also forwarded to `engine.events` by the `Engine` constructor, but
 * secondaries stay isolated.
 *
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
    if (import.meta.env.DEV) setWorldToLocalCheck(warnOnCameraWorldMisuse)
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
    const scale = this.#getActiveCamera()?.screenPxPerWorldUnit() ?? 0
    return scale > 0 ? this.#touchSlopScreenPx / scale : 0
  }

  /**
   * Slop in the world units of the view that places `node`. Differs from
   * {@link InputSystem.touchSlopWorld} for a node under a layer with a space of
   * its own, whose scale is not the camera's.
   */
  touchSlopFor(node: Node2D): number {
    const scale = viewFor(
      node,
      this.#stage,
      this.#engine.debug,
    )?.screenPxPerWorldUnit()
    return scale && scale > 0 ? this.#touchSlopScreenPx / scale : 0
  }

  /**
   * Camera used for world↔screen conversion. When the debug HUD has picked this
   * stage AND the debug camera is toggled on, that camera drives, else the
   * stage's own game camera. Recomputed on every access so pan-under-
   * a-still-finger stays glued during debug camera motion.
   */
  #getActiveCamera(): CameraView2D | null {
    return (
      this.#engine.debug?.activeCameraFor(this.#stage) ??
      this.#stage.currentCamera2D
    )
  }

  /**
   * Active 3D camera (debug fly-cam when engaged, else the stage's game cam),
   * or null.
   */
  #getActiveCamera3d(): CameraView3D | null {
    return (
      this.#engine.debug?.activeCamera3dFor(this.#stage) ??
      this.#stage.currentCamera3D
    )
  }

  /**
   * Hit-test the 3D world for a pointer at canvas-CSS `(sx, sy)`: convert to
   * NDC (full-canvas, since the 3D camera fills the canvas unlike the
   * letterboxed 2D camera), cast a ray, and return the nearest hit-enabled
   * mesh, or `null`.
   *
   * Public because a pointer is captured by whatever it went down on, so `up`
   * arrives there wherever the release actually landed. A control that must not
   * fire when the press is dragged off it has to ask again, and asking here is
   * what keeps that answer identical to the one that started the press,
   * including under the debug fly camera.
   */
  pick3D(sx: number, sy: number): PointerTarget | null {
    if (!this.#stage.tree.has3D) return null
    const cssW = this.#stage.renderer.cssSize.w
    const cssH = this.#stage.renderer.cssSize.h
    if (cssW <= 0 || cssH <= 0) return null
    const ndcX = (2 * sx) / cssW - 1
    const ndcY = 1 - (2 * sy) / cssH
    const cam3d = this.#getActiveCamera3d()
    if (!cam3d) return null
    const ray = cam3d.screenToRay(ndcX, ndcY)
    const hit = raycastWorld3D(this.#stage.tree, ray, (n) => n.hitEnabled)
    return hit?.node ?? null
  }

  /**
   * Called by `Engine.frame()` at the start of every render tick, AFTER any
   * `onBeforeFrame` handlers have updated the active camera. Re-projects every
   * pointer's world coord and emits a synthetic `pointerMove` for any pointer
   * whose world coord drifted without a native event this frame. The stage's
   * listeners and the captured node are told separately, because each sees its
   * own space and only one of them may have moved. A pointer held on a node
   * under a screen layer gets no synthetic move while the camera pans.
   */
  beforeFrame(): void {
    if (this.#disposed || this.#recordsMap.size === 0) return
    for (const record of this.#recordsMap.values()) {
      const moved = this.#project(record)
      if (!record.nativeMoveThisFrame) {
        const stageDrift =
          Math.abs(moved.dx) > 1e-4 || Math.abs(moved.dy) > 1e-4
        const nodeDrift =
          Math.abs(moved.ndx) > 1e-4 || Math.abs(moved.ndy) > 1e-4
        if (stageDrift || nodeDrift) {
          this.#dispatchMove(record, moved, 'synthetic', stageDrift, nodeDrift)
        }
      }
      record.nativeMoveThisFrame = false
    }
  }

  /** What `#project` moved a pointer by, in the camera's and the node's space. */
  readonly #moved = { dx: 0, dy: 0, ndx: 0, ndy: 0 }

  /**
   * The view that places the node holding `record`, or `null` when the node is
   * placed by the camera (or nothing holds the pointer), where its events carry
   * the camera's world.
   */
  #nodeView(record: PointerRecord): CameraView2D | null {
    const target = record.capturedBy
    if (!target || target.kind !== '2d') return null
    const node = target as Node2D
    return layerOf(node) ? viewFor(node, this.#stage) : null
  }

  /**
   * Re-project `record` from its screen position into the camera's world and
   * the captured node's world, and report how far each moved.
   */
  #project(record: PointerRecord): {
    dx: number
    dy: number
    ndx: number
    ndy: number
  } {
    const out = this.#moved
    const screen = record.screen
    const cam = this.#getActiveCamera()
    const prevX = record.world.x
    const prevY = record.world.y
    if (cam) cam.screenToWorld(screen.x, screen.y, record.world)
    out.dx = record.world.x - prevX
    out.dy = record.world.y - prevY
    const view = this.#nodeView(record)
    if (view) {
      const nx = record.nodeWorld.x
      const ny = record.nodeWorld.y
      view.screenToWorld(screen.x, screen.y, record.nodeWorld)
      out.ndx = record.nodeWorld.x - nx
      out.ndy = record.nodeWorld.y - ny
    } else {
      record.nodeWorld.x = record.world.x
      record.nodeWorld.y = record.world.y
      out.ndx = out.dx
      out.ndy = out.dy
    }
    return out
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
    const world = this.#getActiveCamera()?.screenToWorld(
      screen.x,
      screen.y,
    ) ?? { x: 0, y: 0 }
    const record: PointerRecord = {
      id: e.pointerId,
      kind: this.#pointerKind(e),
      screen: { ...screen },
      world: { ...world },
      nodeWorld: { ...world },
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
      // Some browsers throw for touch pointers under specific conditions.
      // We fall back gracefully, global window listeners aren't wired
      // (would require broader refactor), but capture-less operation still
      // works if the pointer stays over the canvas.
    }

    // Node-level hit-test from the canvas position, through the view that
    // places each node: the ACTIVE camera, or the view of a layer with a space
    // of its own. The 2D overlay wins over 3D (it composites on top), and only
    // when nothing 2D is hit do we ray-pick the 3D world.
    const hit: PointerTarget | null =
      findHitNode(
        this.#stage.tree.root,
        screen.x,
        screen.y,
        (node) => viewFor(node, this.#stage, this.#engine.debug),
        this.#touchSlopScreenPx,
      ) ?? this.pick3D(screen.x, screen.y)
    if (hit) {
      record.capturedBy = hit
      this.#project(record)
      // If the node dies while capturing, synthesise cancel + release.
      record.destroyUnsub = hit.events.on('destroy', () => {
        this.#dispatchCancel(record.id, 'synthetic')
      })
      hit.onPointerDown?.(this.#makeEvent(record, 0, 0, 'down', 'native', true))
    }
    this.#emitStage(
      'pointerDown',
      this.#makeEvent(record, 0, 0, 'down', 'native', false),
    )
  }

  /** Emit a stage-level event, noting the camera position it carries. */
  #emitStage(
    name: 'pointerDown' | 'pointerMove' | 'pointerUp' | 'pointerCancel',
    ev: PointerEvent2D,
  ): void {
    lastStageWorldX = ev.pointer.world.x
    lastStageWorldY = ev.pointer.world.y
    this.#stage.events.emit(name, ev)
  }

  #handleMove(e: PointerEvent): void {
    if (this.#disposed) return
    const record = this.#recordsMap.get(e.pointerId)
    if (!record) return
    const screen = this.#toCanvasCss(e)
    record.screen.x = screen.x
    record.screen.y = screen.y
    const moved = this.#project(record)
    record.nativeMoveThisFrame = true
    this.#dispatchMove(record, moved, 'native', true, true)
  }

  /**
   * Dispatch a move to the captured node (`toNode`) and to the stage's
   * listeners (`toStage`), each with the position and delta in its own space.
   */
  #dispatchMove(
    record: PointerRecord,
    moved: { dx: number; dy: number; ndx: number; ndy: number },
    source: 'native' | 'synthetic',
    toStage: boolean,
    toNode: boolean,
  ): void {
    if (toNode && record.capturedBy && !record.capturedBy.isDestroyed) {
      record.capturedBy.onPointerMove?.(
        this.#makeEvent(record, moved.ndx, moved.ndy, 'move', source, true),
      )
    }
    if (toStage) {
      this.#emitStage(
        'pointerMove',
        this.#makeEvent(record, moved.dx, moved.dy, 'move', source, false),
      )
    }
  }

  #handleUp(e: PointerEvent): void {
    if (this.#disposed) return
    const record = this.#recordsMap.get(e.pointerId)
    if (!record) return
    const screen = this.#toCanvasCss(e)
    record.screen.x = screen.x
    record.screen.y = screen.y
    const moved = this.#project(record)

    if (record.capturedBy && !record.capturedBy.isDestroyed) {
      record.capturedBy.onPointerUp?.(
        this.#makeEvent(record, moved.ndx, moved.ndy, 'up', 'native', true),
      )
    }
    this.#emitStage(
      'pointerUp',
      this.#makeEvent(record, moved.dx, moved.dy, 'up', 'native', false),
    )

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
    if (record.capturedBy && !record.capturedBy.isDestroyed) {
      record.capturedBy.onPointerCancel?.(
        this.#makeEvent(record, 0, 0, 'cancel', source, true),
      )
    }
    this.#emitStage(
      'pointerCancel',
      this.#makeEvent(record, 0, 0, 'cancel', source, false),
    )
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

  /**
   * Build the event for `record`. A node's own event (`forNode`) carries the
   * position in the world of the view that places the captured node, and a
   * stage-level event carries it in the camera's world.
   */
  #makeEvent(
    record: PointerRecord,
    dx: number,
    dy: number,
    phase: PointerPhase,
    source: 'native' | 'synthetic',
    forNode: boolean,
  ): PointerEvent2D {
    const at = forNode ? record.nodeWorld : record.world
    const sx = record.screen.x
    const sy = record.screen.y
    const cameraX = record.world.x
    const cameraY = record.world.y
    return {
      pointer: {
        id: record.id,
        kind: record.kind,
        screen: { x: sx, y: sy },
        world: { x: at.x, y: at.y },
        startedAtMs: record.startedAtMs,
        capturedBy: record.capturedBy,
      },
      delta: { x: dx, y: dy },
      phase,
      source,
      stage: this.#stage,
      localTo: (node, out) => {
        // The view that places `node`, which differs from the camera's for a
        // node under a layer with a space of its own.
        const view = viewFor(node, this.#stage, this.#engine.debug)
        const w = view
          ? view.screenToWorld(sx, sy, LOCAL_SCRATCH)
          : { x: cameraX, y: cameraY }
        return node.worldToLocal(w.x, w.y, out)
      },
    }
  }
}
