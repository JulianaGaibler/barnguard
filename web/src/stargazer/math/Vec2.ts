/**
 * A 2D point or vector. Plain mutable `{ x, y }`, no methods.
 *
 * The `vec2*` helpers take a destination `dst` as their first argument, write
 * the result into it, and return it. Passing a scratch object instead of
 * allocating a fresh one keeps the per-frame allocation count flat. Inputs are
 * `Readonly`, so aliasing `dst` with an input is safe.
 *
 * @category Math
 */
export interface Vec2 {
  x: number
  y: number
}

/**
 * Create a vector. Defaults to the origin.
 *
 * @category Math
 */
export function vec2(x = 0, y = 0): Vec2 {
  return { x, y }
}

/**
 * Set `v` to `(x, y)` in place.
 *
 * @category Math
 */
export function vec2Set(v: Vec2, x: number, y: number): Vec2 {
  v.x = x
  v.y = y
  return v
}

/**
 * Copy `src` into `dst`.
 *
 * @category Math
 */
export function vec2Copy(dst: Vec2, src: Readonly<Vec2>): Vec2 {
  dst.x = src.x
  dst.y = src.y
  return dst
}

/**
 * Add `a + b` into `dst`.
 *
 * @category Math
 */
export function vec2Add(dst: Vec2, a: Readonly<Vec2>, b: Readonly<Vec2>): Vec2 {
  dst.x = a.x + b.x
  dst.y = a.y + b.y
  return dst
}

/**
 * Subtract `a - b` into `dst`.
 *
 * @category Math
 */
export function vec2Sub(dst: Vec2, a: Readonly<Vec2>, b: Readonly<Vec2>): Vec2 {
  dst.x = a.x - b.x
  dst.y = a.y - b.y
  return dst
}

/**
 * Scale `a` by scalar `s` into `dst`.
 *
 * @category Math
 */
export function vec2Scale(dst: Vec2, a: Readonly<Vec2>, s: number): Vec2 {
  dst.x = a.x * s
  dst.y = a.y * s
  return dst
}

/**
 * Length of `a`.
 *
 * @category Math
 */
export function vec2Length(a: Readonly<Vec2>): number {
  return Math.hypot(a.x, a.y)
}

/**
 * Squared distance between `a` and `b`. Skips the square root, so use it for
 * distance comparisons where the exact value doesn't matter.
 *
 * @category Math
 */
export function vec2DistanceSq(a: Readonly<Vec2>, b: Readonly<Vec2>): number {
  const dx = a.x - b.x
  const dy = a.y - b.y
  return dx * dx + dy * dy
}

/**
 * Distance between `a` and `b`.
 *
 * @category Math
 */
export function vec2Distance(a: Readonly<Vec2>, b: Readonly<Vec2>): number {
  return Math.hypot(a.x - b.x, a.y - b.y)
}

/**
 * Linearly interpolate from `a` to `b` by `t` into `dst`. `t` of 0 gives `a`, 1
 * gives `b`; values outside `[0, 1]` extrapolate.
 *
 * @category Math
 */
export function vec2Lerp(
  dst: Vec2,
  a: Readonly<Vec2>,
  b: Readonly<Vec2>,
  t: number,
): Vec2 {
  dst.x = a.x + (b.x - a.x) * t
  dst.y = a.y + (b.y - a.y) * t
  return dst
}

/**
 * Dot product `a · b`.
 *
 * @category Math
 */
export function vec2Dot(a: Readonly<Vec2>, b: Readonly<Vec2>): number {
  return a.x * b.x + a.y * b.y
}

/**
 * 2D cross product, the scalar z of `a × b` (`a.x*b.y - a.y*b.x`). Positive
 * when `b` is counter-clockwise from `a`.
 *
 * @category Math
 */
export function vec2Cross(a: Readonly<Vec2>, b: Readonly<Vec2>): number {
  return a.x * b.y - a.y * b.x
}

/**
 * Cross product of a scalar and a vector, `s × v`, into `dst`. This is the `ω ×
 * r` term from rigid-body dynamics: a scalar angular velocity crossed with a
 * radius vector yields the perpendicular linear velocity `(-s*v.y, s*v.x)`.
 *
 * @category Math
 */
export function vec2CrossSV(dst: Vec2, s: number, v: Readonly<Vec2>): Vec2 {
  dst.x = -s * v.y
  dst.y = s * v.x
  return dst
}

/**
 * Left perpendicular of `a`, `(-a.y, a.x)`, into `dst`. Rotates `a` a quarter
 * turn counter-clockwise.
 *
 * @category Math
 */
export function vec2Perp(dst: Vec2, a: Readonly<Vec2>): Vec2 {
  // Read into locals so dst may alias a.
  const x = a.x
  const y = a.y
  dst.x = -y
  dst.y = x
  return dst
}

/**
 * Unit vector in the direction of `a`, into `dst`. A zero-length input yields
 * `(0, 0)` rather than `NaN`.
 *
 * @category Math
 */
export function vec2Normalize(dst: Vec2, a: Readonly<Vec2>): Vec2 {
  const len = Math.hypot(a.x, a.y)
  if (len === 0) {
    dst.x = 0
    dst.y = 0
    return dst
  }
  const inv = 1 / len
  dst.x = a.x * inv
  dst.y = a.y * inv
  return dst
}

/**
 * Rotate `a` by `radians` counter-clockwise, into `dst`.
 *
 * @category Math
 */
export function vec2Rotate(
  dst: Vec2,
  a: Readonly<Vec2>,
  radians: number,
): Vec2 {
  const c = Math.cos(radians)
  const s = Math.sin(radians)
  // Read into locals so dst may alias a.
  const x = a.x
  const y = a.y
  dst.x = x * c - y * s
  dst.y = x * s + y * c
  return dst
}

/**
 * Negate `a`, into `dst`.
 *
 * @category Math
 */
export function vec2Negate(dst: Vec2, a: Readonly<Vec2>): Vec2 {
  dst.x = -a.x
  dst.y = -a.y
  return dst
}
