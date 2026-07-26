/**
 * A rotation quaternion, plain mutable `{ x, y, z, w }` with `w` the scalar
 * part. The identity rotation is `(0, 0, 0, 1)`. Quaternions avoid gimbal lock
 * and interpolate cleanly (see {@link quatSlerp}), so they are the rotation
 * representation for {@link Transform3D}.
 *
 * The `quat*` helpers follow the engine convention: destination `dst` first,
 * `Readonly` inputs, result written into and returned as `dst`.
 *
 * @category Math
 */
export interface Quat {
  x: number
  y: number
  z: number
  w: number
}

/**
 * Create a quaternion. Defaults to the identity rotation.
 *
 * @category Math
 */
export function quat(x = 0, y = 0, z = 0, w = 1): Quat {
  return { x, y, z, w }
}

/**
 * Reset `q` to the identity rotation.
 *
 * @category Math
 */
export function quatIdentity(q: Quat): Quat {
  q.x = 0
  q.y = 0
  q.z = 0
  q.w = 1
  return q
}

/**
 * Copy `src` into `dst`.
 *
 * @category Math
 */
export function quatCopy(dst: Quat, src: Readonly<Quat>): Quat {
  dst.x = src.x
  dst.y = src.y
  dst.z = src.z
  dst.w = src.w
  return dst
}

/**
 * Set `dst` to a rotation of `radians` about the unit axis `(ax, ay, az)`.
 *
 * @category Math
 */
export function quatFromAxisAngle(
  dst: Quat,
  ax: number,
  ay: number,
  az: number,
  radians: number,
): Quat {
  const half = radians / 2
  const s = Math.sin(half)
  dst.x = ax * s
  dst.y = ay * s
  dst.z = az * s
  dst.w = Math.cos(half)
  return dst
}

/**
 * Hamilton product `dst = a × b`: the rotation that applies `b` then `a`. Reads
 * inputs into locals, so `dst` may alias `a` or `b`.
 *
 * @category Math
 */
export function quatMultiply(
  dst: Quat,
  a: Readonly<Quat>,
  b: Readonly<Quat>,
): Quat {
  const ax = a.x
  const ay = a.y
  const az = a.z
  const aw = a.w
  const bx = b.x
  const by = b.y
  const bz = b.z
  const bw = b.w
  dst.x = aw * bx + ax * bw + ay * bz - az * by
  dst.y = aw * by - ax * bz + ay * bw + az * bx
  dst.z = aw * bz + ax * by - ay * bx + az * bw
  dst.w = aw * bw - ax * bx - ay * by - az * bz
  return dst
}

/**
 * Unit quaternion in the direction of `a`, into `dst`. A zero-length input
 * yields the identity rather than `NaN`.
 *
 * @category Math
 */
export function quatNormalize(dst: Quat, a: Readonly<Quat>): Quat {
  const len = Math.hypot(a.x, a.y, a.z, a.w)
  if (len === 0) return quatIdentity(dst)
  const inv = 1 / len
  dst.x = a.x * inv
  dst.y = a.y * inv
  dst.z = a.z * inv
  dst.w = a.w * inv
  return dst
}

/**
 * Spherical linear interpolation from `a` to `b` by `t`, into `dst`. Takes the
 * shorter arc (flips `b` when the quaternions face opposite hemispheres) and
 * falls back to a normalized linear blend when the inputs are nearly parallel,
 * so it never divides by a near-zero `sin`.
 *
 * @category Math
 */
export function quatSlerp(
  dst: Quat,
  a: Readonly<Quat>,
  b: Readonly<Quat>,
  t: number,
): Quat {
  const ax = a.x
  const ay = a.y
  const az = a.z
  const aw = a.w
  let bx = b.x
  let by = b.y
  let bz = b.z
  let bw = b.w

  let cos = ax * bx + ay * by + az * bz + aw * bw
  // Take the shorter path around the hypersphere.
  if (cos < 0) {
    cos = -cos
    bx = -bx
    by = -by
    bz = -bz
    bw = -bw
  }

  let scaleA: number
  let scaleB: number
  if (1 - cos > 1e-6) {
    const theta = Math.acos(cos)
    const sin = Math.sin(theta)
    scaleA = Math.sin((1 - t) * theta) / sin
    scaleB = Math.sin(t * theta) / sin
  } else {
    // Nearly parallel: linear blend avoids a division by ~0.
    scaleA = 1 - t
    scaleB = t
  }

  dst.x = scaleA * ax + scaleB * bx
  dst.y = scaleA * ay + scaleB * by
  dst.z = scaleA * az + scaleB * bz
  dst.w = scaleA * aw + scaleB * bw
  return dst
}
