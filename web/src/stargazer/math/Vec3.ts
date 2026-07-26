/**
 * A 3D point or vector. Plain mutable `{ x, y, z }`, no methods.
 *
 * The `vec3*` helpers take a destination `dst` as their first argument, write
 * the result into it, and return it. Passing a scratch object instead of
 * allocating a fresh one keeps the per-frame allocation count flat. Inputs are
 * `Readonly`, so aliasing `dst` with an input is safe.
 *
 * The 3D world is right-handed, y-up, in meters (glTF convention).
 *
 * @category Math
 */
export interface Vec3 {
  x: number
  y: number
  z: number
}

/**
 * Create a vector. Defaults to the origin.
 *
 * @category Math
 */
export function vec3(x = 0, y = 0, z = 0): Vec3 {
  return { x, y, z }
}

/**
 * Set `v` to `(x, y, z)` in place.
 *
 * @category Math
 */
export function vec3Set(v: Vec3, x: number, y: number, z: number): Vec3 {
  v.x = x
  v.y = y
  v.z = z
  return v
}

/**
 * Copy `src` into `dst`.
 *
 * @category Math
 */
export function vec3Copy(dst: Vec3, src: Readonly<Vec3>): Vec3 {
  dst.x = src.x
  dst.y = src.y
  dst.z = src.z
  return dst
}

/**
 * Add `a + b` into `dst`.
 *
 * @category Math
 */
export function vec3Add(dst: Vec3, a: Readonly<Vec3>, b: Readonly<Vec3>): Vec3 {
  dst.x = a.x + b.x
  dst.y = a.y + b.y
  dst.z = a.z + b.z
  return dst
}

/**
 * Subtract `a - b` into `dst`.
 *
 * @category Math
 */
export function vec3Sub(dst: Vec3, a: Readonly<Vec3>, b: Readonly<Vec3>): Vec3 {
  dst.x = a.x - b.x
  dst.y = a.y - b.y
  dst.z = a.z - b.z
  return dst
}

/**
 * Scale `a` by scalar `s` into `dst`.
 *
 * @category Math
 */
export function vec3Scale(dst: Vec3, a: Readonly<Vec3>, s: number): Vec3 {
  dst.x = a.x * s
  dst.y = a.y * s
  dst.z = a.z * s
  return dst
}

/**
 * Length of `a`.
 *
 * @category Math
 */
export function vec3Length(a: Readonly<Vec3>): number {
  return Math.hypot(a.x, a.y, a.z)
}

/**
 * Squared distance between `a` and `b`. Skips the square root, so use it for
 * distance comparisons where the exact value doesn't matter.
 *
 * @category Math
 */
export function vec3DistanceSq(a: Readonly<Vec3>, b: Readonly<Vec3>): number {
  const dx = a.x - b.x
  const dy = a.y - b.y
  const dz = a.z - b.z
  return dx * dx + dy * dy + dz * dz
}

/**
 * Distance between `a` and `b`.
 *
 * @category Math
 */
export function vec3Distance(a: Readonly<Vec3>, b: Readonly<Vec3>): number {
  return Math.hypot(a.x - b.x, a.y - b.y, a.z - b.z)
}

/**
 * Linearly interpolate from `a` to `b` by `t` into `dst`. `t` of 0 gives `a`, 1
 * gives `b`; values outside `[0, 1]` extrapolate.
 *
 * @category Math
 */
export function vec3Lerp(
  dst: Vec3,
  a: Readonly<Vec3>,
  b: Readonly<Vec3>,
  t: number,
): Vec3 {
  dst.x = a.x + (b.x - a.x) * t
  dst.y = a.y + (b.y - a.y) * t
  dst.z = a.z + (b.z - a.z) * t
  return dst
}

/**
 * Dot product `a · b`.
 *
 * @category Math
 */
export function vec3Dot(a: Readonly<Vec3>, b: Readonly<Vec3>): number {
  return a.x * b.x + a.y * b.y + a.z * b.z
}

/**
 * Cross product `a × b` into `dst`. Right-handed. Safe when `dst` aliases an
 * input (reads into locals).
 *
 * @category Math
 */
export function vec3Cross(
  dst: Vec3,
  a: Readonly<Vec3>,
  b: Readonly<Vec3>,
): Vec3 {
  const ax = a.x
  const ay = a.y
  const az = a.z
  const bx = b.x
  const by = b.y
  const bz = b.z
  dst.x = ay * bz - az * by
  dst.y = az * bx - ax * bz
  dst.z = ax * by - ay * bx
  return dst
}

/**
 * Unit vector in the direction of `a`, into `dst`. A zero-length input yields
 * `(0, 0, 0)` rather than `NaN`.
 *
 * @category Math
 */
export function vec3Normalize(dst: Vec3, a: Readonly<Vec3>): Vec3 {
  const len = Math.hypot(a.x, a.y, a.z)
  if (len === 0) {
    dst.x = 0
    dst.y = 0
    dst.z = 0
    return dst
  }
  const inv = 1 / len
  dst.x = a.x * inv
  dst.y = a.y * inv
  dst.z = a.z * inv
  return dst
}

/**
 * Negate `a`, into `dst`.
 *
 * @category Math
 */
export function vec3Negate(dst: Vec3, a: Readonly<Vec3>): Vec3 {
  dst.x = -a.x
  dst.y = -a.y
  dst.z = -a.z
  return dst
}
