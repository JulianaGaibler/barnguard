/**
 * The layout protocol: {@link Measurable} (what a layout pass calls) and
 * {@link LayoutNode} (the base class most layout containers extend), plus the
 * internal glue the pass uses to find a subtree's owning root.
 *
 * @module
 * @category Layout
 */
import { SceneNode } from '../scene/SceneNode'
import { BoxConstraints, type Size } from './constraints'

/**
 * A node that takes part in layout. A parent calls `measure` to learn a child's
 * size under {@link BoxConstraints}, then `arrange` to place it. A built-in leaf
 * like `ShapeNode` implements this directly; the containers ({@link Row},
 * {@link Column}, {@link Box}, ...) extend {@link LayoutNode}, which implements it
 * for you.
 *
 * The contract, in order, every frame layout runs:
 *
 * 1. `measure(constraints)` computes the node's size, writes it into the
 *    preallocated {@link Measurable.measuredSize}, and returns it. Constraints
 *    flow DOWN; sizes flow UP.
 * 2. `arrange(x, y, w, h)` positions the node (by setting `transform.x/y`) and,
 *    for a container, positions its children. Placement flows DOWN.
 *
 * @category Layout
 */
export interface Measurable {
  /**
   * The size computed by the last `measure`. Preallocated and reused, so a
   * layout pass allocates nothing. Read it right after `measure`; a later
   * `measure` on the same node overwrites it.
   */
  readonly measuredSize: Size
  /** Compute the size under `constraints`; write into and return `measuredSize`. */
  measure(constraints: BoxConstraints): Size
  /** Place at `(x, y)` with final size `w × h`, in the parent's local space. */
  arrange(x: number, y: number, w: number, h: number): void
}

/**
 * A scene node that participates in layout: a {@link SceneNode} that also
 * implements {@link Measurable}. This is the child type the layout containers
 * accept.
 *
 * @category Layout
 */
export type MeasurableNode = SceneNode & Measurable

/**
 * Base class for layout containers. Extend it and implement {@link measure} and
 * {@link arrange}; it wires the shared pieces (a preallocated `measuredSize` and
 * {@link markLayoutDirty}) onto a normal {@link SceneNode}, so a layout node
 * composes with transforms, culling, hit-testing, behaviors, and tweens like
 * any other node.
 *
 * `arrange` should set `transform.x`/`transform.y` for position (never scale)
 * and write `debugBounds = { x: 0, y: 0, width: w, height: h }` so the node
 * culls and hit-tests correctly. Call {@link markLayoutDirty} whenever an input
 * that affects your measured size changes (a child added, a size prop set); it
 * schedules one coalesced layout pass on the next frame.
 *
 * @category Layout
 * @example
 *   class FixedBox extends LayoutNode {
 *     constructor(
 *       private w: number,
 *       private h: number,
 *     ) {
 *       super('fixed-box')
 *     }
 *     measure(c: BoxConstraints): Size {
 *       this.measuredSize.w = c.constrainW(this.w)
 *       this.measuredSize.h = c.constrainH(this.h)
 *       return this.measuredSize
 *     }
 *     arrange(x: number, y: number, w: number, h: number): void {
 *       this.transform.x = x
 *       this.transform.y = y
 *       this.debugBounds = { x: 0, y: 0, width: w, height: h }
 *     }
 *   }
 */
export abstract class LayoutNode extends SceneNode implements Measurable {
  /**
   * Preallocated per node; `measure` writes into it (see
   * {@link Measurable.measuredSize}).
   */
  readonly measuredSize: Size = { w: 0, h: 0 }

  abstract measure(constraints: BoxConstraints): Size
  abstract arrange(x: number, y: number, w: number, h: number): void

  /**
   * Request a layout pass. Walks up to the owning {@link LayoutRoot} and marks
   * it dirty; the engine runs one coalesced pass next frame. A no-op if the
   * node is not yet under a root. Cheap (a flag set plus an ancestor walk), so
   * call it freely whenever a measured-size input changes.
   */
  markLayoutDirty(): void {
    // A LayoutNode is never itself the host, so start at the parent.
    let n: SceneNode | null = this.parent
    while (n) {
      if (isLayoutHost(n)) {
        n.requestLayout()
        return
      }
      n = n.parent
    }
  }
}

/**
 * The owning driver of a layout subtree (a {@link LayoutRoot}). Internal: the
 * pass and {@link LayoutNode.markLayoutDirty} use it to find where to schedule a
 * relayout without importing the concrete class (which would form a cycle).
 */
export interface LayoutHost {
  requestLayout(): void
}

/** Internal: duck-type test for a {@link LayoutHost} while walking ancestors. */
export function isLayoutHost(n: unknown): n is LayoutHost {
  return (
    typeof n === 'object' &&
    n !== null &&
    typeof (n as LayoutHost).requestLayout === 'function'
  )
}

/**
 * Internal: whether a scene node participates in layout (implements
 * {@link Measurable}). The pass and containers use it to decide whether to
 * measure/arrange a child or treat it as a fixed, unmanaged node.
 */
export function isMeasurable(n: SceneNode): n is SceneNode & Measurable {
  const m = n as unknown as Partial<Measurable>
  return typeof m.measure === 'function' && typeof m.arrange === 'function'
}

/**
 * Internal: throw a named error if a measured size is not finite. A non-finite
 * size means a node read an unbounded (`Infinity`) constraint as its own extent
 * instead of shrink-wrapping; catching it here turns a silent poisoned
 * transform into a clear failure.
 */
export function assertFiniteSize(node: SceneNode, size: Size): void {
  if (!Number.isFinite(size.w) || !Number.isFinite(size.h)) {
    throw new Error(
      `[stargazer] layout: ${node.constructor.name}('${node.id}') produced a ` +
        `non-finite size { w: ${size.w}, h: ${size.h} }. A node measured on an ` +
        `unbounded axis must size to its content, not to maxW/maxH.`,
    )
  }
}
