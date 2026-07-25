/**
 * An axis-aligned rectangle in world coords: top-left corner `(x, y)` plus
 * `width` and `height`. Plain mutable object, no methods.
 *
 * Like the `vec2*` helpers, `rectCopy` and `rectUnion` write into a `dst`
 * passed as the first argument and return it, so a scratch rect can be reused
 * across frames instead of allocating.
 *
 * @category Math
 */

import { clamp } from './scalar'

export interface Rect {
  x: number
  y: number
  width: number
  height: number
}

/**
 * Create a rectangle. Defaults to a zero-size rect at the origin.
 *
 * @category Math
 */
export function rect(x = 0, y = 0, width = 0, height = 0): Rect {
  return { x, y, width, height }
}

/**
 * Copy `src` into `dst`.
 *
 * @category Math
 */
export function rectCopy(dst: Rect, src: Readonly<Rect>): Rect {
  dst.x = src.x
  dst.y = src.y
  dst.width = src.width
  dst.height = src.height
  return dst
}

/**
 * Whether the point `(x, y)` is inside `r`. The left and top edges are
 * inclusive, the right and bottom edges exclusive.
 *
 * @category Math
 */
export function rectContains(r: Readonly<Rect>, x: number, y: number): boolean {
  return x >= r.x && x < r.x + r.width && y >= r.y && y < r.y + r.height
}

/**
 * Whether `a` and `b` overlap. Edge-only contact does not count as an
 * intersection.
 *
 * @category Math
 */
export function rectIntersects(a: Readonly<Rect>, b: Readonly<Rect>): boolean {
  return !(
    a.x + a.width <= b.x ||
    b.x + b.width <= a.x ||
    a.y + a.height <= b.y ||
    b.y + b.height <= a.y
  )
}

/**
 * Smallest rectangle covering both `a` and `b`, written into `dst`.
 *
 * @category Math
 */
export function rectUnion(
  dst: Rect,
  a: Readonly<Rect>,
  b: Readonly<Rect>,
): Rect {
  const x = Math.min(a.x, b.x)
  const y = Math.min(a.y, b.y)
  const right = Math.max(a.x + a.width, b.x + b.width)
  const bottom = Math.max(a.y + a.height, b.y + b.height)
  dst.x = x
  dst.y = y
  dst.width = right - x
  dst.height = bottom - y
  return dst
}

/**
 * The world point at fractions `(fx, fy)` across `r`, where `0` is the left or
 * top edge and `1` is the right or bottom. Values outside `[0, 1]` fall outside
 * `r`. Use `0.5, 0.5` for the center.
 *
 * @category Math
 * @example
 *   rectPointAt(board, 0.5, 0.5) // center of the board, in world coords
 */
export function rectPointAt(
  r: Readonly<Rect>,
  fx: number,
  fy: number,
): { x: number; y: number } {
  return { x: r.x + r.width * fx, y: r.y + r.height * fy }
}

/**
 * The fractional position of the point `(x, y)` within `r`, the inverse of
 * {@link rectPointAt}. Multiply by 100 for a CSS percentage of a `domAnchor`ed
 * overlay sized to `r`. Not clamped, so a point outside `r` maps outside `[0,
 * 1]`. A zero-width or zero-height axis reports `0` rather than `NaN`.
 *
 * @category Math
 * @example
 *   const f = rectPercentOf(gameRect, worldX, worldY)
 *   el.style.left = `${f.x * 100}%`
 *   el.style.top = `${f.y * 100}%`
 */
export function rectPercentOf(
  r: Readonly<Rect>,
  x: number,
  y: number,
): { x: number; y: number } {
  return {
    x: r.width === 0 ? 0 : (x - r.x) / r.width,
    y: r.height === 0 ? 0 : (y - r.y) / r.height,
  }
}

/**
 * The four margin bands between `inner` and the edges of `container`. The
 * `left` and `right` bands span the full container height, and `top` and
 * `bottom` span the full width, so each corner belongs to two bands. This lets
 * you center content in a side margin across the whole height. A band whose
 * size would be negative, when `inner` extends past that edge, is clamped to
 * zero.
 *
 * @category Math
 * @example
 *   // Center a badge in the gap to the left of a centered board:
 *   const m = rectMargins(gameRect, board)
 *   const { x, y } = rectPointAt(m.left, 0.5, 0.5)
 */
export function rectMargins(
  container: Readonly<Rect>,
  inner: Readonly<Rect>,
): { left: Rect; right: Rect; top: Rect; bottom: Rect } {
  const rightX = inner.x + inner.width
  const bottomY = inner.y + inner.height
  return {
    left: {
      x: container.x,
      y: container.y,
      width: Math.max(0, inner.x - container.x),
      height: container.height,
    },
    right: {
      x: rightX,
      y: container.y,
      width: Math.max(0, container.x + container.width - rightX),
      height: container.height,
    },
    top: {
      x: container.x,
      y: container.y,
      width: container.width,
      height: Math.max(0, inner.y - container.y),
    },
    bottom: {
      x: container.x,
      y: bottomY,
      width: container.width,
      height: Math.max(0, container.y + container.height - bottomY),
    },
  }
}

/**
 * A copy of `r` moved, not resized, to sit fully inside `bounds` after
 * insetting every edge by `margin`. When `r` is wider or taller than that inset
 * area on an axis it pins to the start (left or top) edge.
 *
 * @category Math
 * @example
 *   // Keep a tooltip on screen next to the cursor:
 *   const placed = clampRectToBounds(rect(cx, cy, tipW, tipH), viewport, 8)
 */
export function clampRectToBounds(
  r: Readonly<Rect>,
  bounds: Readonly<Rect>,
  margin = 0,
): Rect {
  const minX = bounds.x + margin
  const minY = bounds.y + margin
  const maxX = bounds.x + bounds.width - margin - r.width
  const maxY = bounds.y + bounds.height - margin - r.height
  return {
    x: maxX < minX ? minX : clamp(r.x, minX, maxX),
    y: maxY < minY ? minY : clamp(r.y, minY, maxY),
    width: r.width,
    height: r.height,
  }
}
