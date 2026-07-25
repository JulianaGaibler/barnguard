/**
 * Alignment primitives shared by the layout nodes and usable on their own.
 * {@link alignWithin} places a box inside a bounding {@link Rect} without a
 * {@link LayoutRoot} tree, so game code can position a scene node, a raw rect,
 * or a `domAnchor`ed HTML overlay against a board or the visible game rect.
 *
 * @module
 * @category Layout
 */
import type { Rect } from '../math/Rect'

/**
 * One-axis placement, used by {@link Align}, {@link Stack}, and
 * {@link alignWithin}.
 */
export type Align1D = 'start' | 'center' | 'end' | 'stretch'

/**
 * Offset that positions a child along one axis, given the `free` space left
 * over after the child (`container - child`). `'center'` takes half, `'end'`
 * takes all of it, `'start'` and `'stretch'` sit at the origin.
 *
 * @category Layout
 * @example
 *   // A 40-wide child in a 100-wide box:
 *   alignOffset('start', 60) // 0
 *   alignOffset('center', 60) // 30
 *   alignOffset('end', 60) // 60
 */
export function alignOffset(align: Align1D, free: number): number {
  if (align === 'center') return free / 2
  if (align === 'end') return free
  return 0
}

/**
 * Top-left world point for a `width`×`height` box placed inside `container` by
 * `alignX`/`alignY`. The standalone counterpart to {@link Align} for code that
 * does its own drawing or DOM positioning. This returns a point, not a size, so
 * `'stretch'` behaves like `'start'`.
 *
 * @category Layout
 * @example
 *   // Center a 120×48 badge in the gap to the right of a board:
 *   const { x, y } = alignWithin(rightMargin, 120, 48, 'center', 'center')
 *   node.transform.x = x
 *   node.transform.y = y
 */
export function alignWithin(
  container: Readonly<Rect>,
  width: number,
  height: number,
  alignX: Align1D,
  alignY: Align1D,
): { x: number; y: number } {
  return {
    x: container.x + alignOffset(alignX, container.width - width),
    y: container.y + alignOffset(alignY, container.height - height),
  }
}
