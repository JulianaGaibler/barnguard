/**
 * Allocation-free helpers for 2D affines, on any {@link Affine2x3} such as
 * `Transform2D.world`.
 */

import type { Vec2 } from './Vec2'
import type { Affine2x3 } from './Affine2D'

/**
 * Copy the six 2D affine components from `src` to `dst` in place.
 *
 * @internal Test-only helper. Not part of the public API.
 */
export function copyMatrix2D(dst: Affine2x3, src: Affine2x3): void {
  dst.a = src.a
  dst.b = src.b
  dst.c = src.c
  dst.d = src.d
  dst.e = src.e
  dst.f = src.f
}

/**
 * Multiply two 2D affine matrices without allocation: `dst = a × b`. Safe when
 * `dst` aliases `a` or `b` (uses locals).
 */
export function multiplyMatrix2D(
  dst: Affine2x3,
  a: Affine2x3,
  b: Affine2x3,
): void {
  const aa = a.a
  const ab = a.b
  const ac = a.c
  const ad = a.d
  const ae = a.e
  const af = a.f
  const ba = b.a
  const bb = b.b
  const bc = b.c
  const bd = b.d
  const be = b.e
  const bf = b.f
  dst.a = aa * ba + ac * bb
  dst.b = ab * ba + ad * bb
  dst.c = aa * bc + ac * bd
  dst.d = ab * bc + ad * bd
  dst.e = aa * be + ac * bf + ae
  dst.f = ab * be + ad * bf + af
}

/**
 * Inverse of a 2D affine, `dst = inv(src)`. Safe when `dst` aliases `src`
 * (reads into locals). Returns `false` and leaves `dst` an identity matrix when
 * `src` is singular (zero determinant).
 */
export function invertMatrix2D(dst: Affine2x3, src: Affine2x3): boolean {
  const a = src.a
  const b = src.b
  const c = src.c
  const d = src.d
  const e = src.e
  const f = src.f
  const det = a * d - b * c
  if (det === 0) {
    dst.a = 1
    dst.b = 0
    dst.c = 0
    dst.d = 1
    dst.e = 0
    dst.f = 0
    return false
  }
  const invDet = 1 / det
  dst.a = d * invDet
  dst.b = -b * invDet
  dst.c = -c * invDet
  dst.d = a * invDet
  dst.e = (c * f - d * e) * invDet
  dst.f = (b * e - a * f) * invDet
  return true
}

/** Apply a 2D affine to the point `(x, y)`: `dst = m · (x, y)`, into `dst`. */
export function transformPoint2D(
  dst: Vec2,
  m: Affine2x3,
  x: number,
  y: number,
): Vec2 {
  dst.x = m.a * x + m.c * y + m.e
  dst.y = m.b * x + m.d * y + m.f
  return dst
}
