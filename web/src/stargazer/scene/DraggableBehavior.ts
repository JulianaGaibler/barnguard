import { PointerBehavior } from './PointerBehavior'
import type { Node2D, PointerHandlers } from './Node2D'
import type { PointerEvent2D } from '../input/PointerState'
import type { Vec2 } from '../math/Vec2'
import { ignoreAbort } from '../anim/abortSignal'

const DEFAULT_THRESHOLD = 8
const DEFAULT_SNAP_DURATION = 0.18

/**
 * How a node behaves as a draggable, and what happens when it is dropped.
 *
 * `T` is the caller's drop-target type — a node, a grid cell, a rect id,
 * anything `findDropTarget` chooses to return.
 */
export interface DraggableOptions<T = unknown> {
  /** A press is ignored entirely while this is (or returns) false. */
  enabled?: boolean | (() => boolean)
  /**
   * World-px a press must travel before it is a drag rather than a tap. Default
   * 8.
   */
  threshold?: number
  /**
   * Reparented here for the drag so it paints above its neighbours; the node is
   * kept here through the snap-back too, and returns to its home parent only
   * once it has settled. Omit to drag in place.
   */
  dragLayer?: Node2D
  /** Track only the first pressed pointer. Default true. */
  singlePointer?: boolean
  /** The drop target under the pointer, or null over nothing. */
  findDropTarget?: (world: Readonly<Vec2>, e: PointerEvent2D) => T | null
  /**
   * Compare two targets so `onDragMove` fires only when the target really
   * changes. Defaults to `===`, so a `findDropTarget` that returns a fresh
   * object each call must supply this (or return stable
   * references/primitives).
   */
  equals?: (a: T, b: T) => boolean
  onDragStart?: (e: PointerEvent2D) => void
  /** The hovered target changed (null when the pointer left every target). */
  onDragMove?: (target: T | null, e: PointerEvent2D) => void
  onDrop?: (target: T, e: PointerEvent2D) => void
  /**
   * Released off any target, or a system cancel (`e` undefined). Fires at
   * release, before the snap.
   */
  onDragCancel?: (e?: PointerEvent2D) => void
  /** Press and release below `threshold` — no drag happened. */
  onTap?: (e: PointerEvent2D) => void
  /**
   * The node is back in its home parent and idle: after a drop, or after the
   * snap-back finishes.
   */
  onSettled?: () => void
  /** Animate back to the grab origin when a drag ends off-target. Default true. */
  snapBack?: boolean
  snapDuration?: number
}

interface Home {
  parent: Node2D
  x: number
  y: number
}

/**
 * Drag a node onto a drop target. Attach with `node.addBehavior(...)`.
 *
 * A press below `threshold` is a tap (`onTap`); past it the node lifts into
 * `dragLayer` and follows the pointer, `findDropTarget` resolves what is under
 * it (reported via `onDragMove`), and release either drops onto a target
 * (`onDrop`) or snaps back (`onDragCancel` at release, then `onSettled` once
 * the animation lands).
 *
 * @example
 *   node.addBehavior(
 *     new DraggableBehavior<Cell>({
 *       dragLayer,
 *       findDropTarget: (w) => cellAt(w),
 *       onDrop: (cell) => place(cell),
 *     }),
 *   )
 */
export class DraggableBehavior<T = unknown> extends PointerBehavior {
  readonly #opts: DraggableOptions<T>
  #home: Home | null = null
  #grabX = 0
  #grabY = 0
  #pressX = 0
  #pressY = 0
  #dragging = false
  #target: T | null = null
  #snap: AbortController | null = null

  constructor(opts: DraggableOptions<T> = {}) {
    super()
    this.#opts = opts
  }

  /**
   * True while a drag or its snap-back is in flight — the node is not settled
   * at home.
   */
  get isDragging(): boolean {
    return this.#dragging || this.#snap !== null
  }

  protected handlers(): PointerHandlers {
    return {
      singlePointer: this.#opts.singlePointer ?? true,
      down: (e) => this.#onDown(e),
      move: (e) => this.#onMove(e),
      up: (e) => this.#onUp(e),
      cancel: () => this.#onCancel(),
    }
  }

  protected override onPointerDetach(): void {
    this.#snap?.abort()
    this.#snap = null
    this.#home = null
    this.#dragging = false
  }

  #isEnabled(): boolean {
    const e = this.#opts.enabled
    return e === undefined ? true : typeof e === 'function' ? e() : e
  }

  #onDown(e: PointerEvent2D): void {
    if (!this.#isEnabled()) return
    const node = this.node
    if (this.#snap) {
      // Re-grab mid snap-back: abort the tween, keep the original home.
      this.#snap.abort()
      this.#snap = null
    } else {
      const parent = node.parent as Node2D | null
      if (!parent) return
      this.#home = { parent, x: node.transform.x, y: node.transform.y }
    }
    // World-space, so promotion into a differently scaled/rotated drag layer
    // can't make the node jump.
    const origin = node.localToWorld(0, 0)
    this.#grabX = e.pointer.world.x - origin.x
    this.#grabY = e.pointer.world.y - origin.y
    this.#pressX = e.pointer.world.x
    this.#pressY = e.pointer.world.y
    this.#dragging = false
    this.#target = null
  }

  #onMove(e: PointerEvent2D): void {
    if (!this.#home) return
    if (!this.#dragging) {
      const dx = e.pointer.world.x - this.#pressX
      const dy = e.pointer.world.y - this.#pressY
      const t = this.#opts.threshold ?? DEFAULT_THRESHOLD
      if (dx * dx + dy * dy <= t * t) return
      this.#dragging = true
      this.#opts.dragLayer?.add(this.node)
      this.#opts.onDragStart?.(e)
    }
    this.#follow(e.pointer.world)
    const next = this.#opts.findDropTarget?.(e.pointer.world, e) ?? null
    if (!this.#sameTarget(next, this.#target)) {
      this.#target = next
      this.#opts.onDragMove?.(next, e)
    }
  }

  #onUp(e: PointerEvent2D): void {
    if (!this.#home) return
    if (!this.#dragging) {
      this.#opts.onTap?.(e)
      this.#home = null
      return
    }
    this.#dragging = false
    this.#target = null
    const target = this.#opts.findDropTarget?.(e.pointer.world, e) ?? null
    if (target !== null) {
      this.#reparentHome()
      this.#home = null
      this.#opts.onDrop?.(target, e)
      this.#opts.onSettled?.()
    } else {
      this.#opts.onDragCancel?.(e)
      this.#snapBack()
    }
  }

  #onCancel(): void {
    if (!this.#home) return
    if (!this.#dragging) {
      this.#home = null
      return
    }
    this.#dragging = false
    this.#target = null
    this.#opts.onDragCancel?.()
    this.#snapBack()
  }

  #follow(world: Readonly<Vec2>): void {
    const node = this.node
    const parent = (node.parent as Node2D | null) ?? node
    const l = parent.worldToLocal(world.x - this.#grabX, world.y - this.#grabY)
    node.transform.x = l.x
    node.transform.y = l.y
  }

  #snapBack(): void {
    const home = this.#home
    if (!home) return
    if (this.#opts.snapBack === false) {
      this.#reparentHome()
      this.#home = null
      this.#opts.onSettled?.()
      return
    }
    // Tween in the current (drag-layer) space toward the home position, staying
    // reparented so a layout pass that skips drag-layer nodes leaves it alone.
    const node = this.node
    const parent = (node.parent as Node2D | null) ?? node
    const w = home.parent.localToWorld(home.x, home.y)
    const dest = parent.worldToLocal(w.x, w.y)
    const ctrl = new AbortController()
    this.#snap = ctrl
    node
      .tween(
        { x: dest.x, y: dest.y },
        {
          duration: this.#opts.snapDuration ?? DEFAULT_SNAP_DURATION,
          signal: ctrl.signal,
        },
      )
      .then(() => {
        if (this.#snap !== ctrl) return
        this.#snap = null
        this.#reparentHome()
        this.#home = null
        this.#opts.onSettled?.()
      })
      .catch(ignoreAbort)
  }

  #reparentHome(): void {
    const home = this.#home
    if (!home) return
    home.parent.add(this.node)
    this.node.transform.x = home.x
    this.node.transform.y = home.y
  }

  #sameTarget(a: T | null, b: T | null): boolean {
    if (a === b) return true
    if (a === null || b === null) return false
    return this.#opts.equals ? this.#opts.equals(a, b) : false
  }
}
