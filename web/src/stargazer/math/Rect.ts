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
