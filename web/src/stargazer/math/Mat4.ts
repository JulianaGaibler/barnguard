/**
 * A 4×4 matrix stored column-major in a `Float32Array(16)`, matching WebGL's
 * `uniformMatrix4fv(..., false, m)` layout so a `Mat4` uploads without a
 * transpose. Element `(row, col)` lives at index `col * 4 + row`; translation
 * sits in `m[12] m[13] m[14]`.
 *
 * Like the `vec3*` helpers, the `mat4*` functions take a destination `dst`
 * first, write into it, and return it, so per-frame math need not allocate.
 * Functions that read every input element before writing are safe when `dst`
 * aliases an input.
 *
 * @category Math
 */
export type Mat4 = Float32Array

import type { Vec3 } from './Vec3'
import type { Quat } from './Quat'

/**
 * Create a new identity matrix.
 *
 * @category Math
 */
export function mat4(): Mat4 {
  const m = new Float32Array(16)
  m[0] = 1
  m[5] = 1
  m[10] = 1
  m[15] = 1
  return m
}

/**
 * Reset `dst` to the identity matrix.
 *
 * @category Math
 */
export function mat4Identity(dst: Mat4): Mat4 {
  dst[0] = 1
  dst[1] = 0
  dst[2] = 0
  dst[3] = 0
  dst[4] = 0
  dst[5] = 1
  dst[6] = 0
  dst[7] = 0
  dst[8] = 0
  dst[9] = 0
  dst[10] = 1
  dst[11] = 0
  dst[12] = 0
  dst[13] = 0
  dst[14] = 0
  dst[15] = 1
  return dst
}

/**
 * Copy `src` into `dst`.
 *
 * @category Math
 */
export function mat4Copy(dst: Mat4, src: Readonly<Mat4>): Mat4 {
  dst.set(src)
  return dst
}

/**
 * Matrix product `dst = a × b` (column-major, so a point is transformed by `a`
 * after `b`). Reads both inputs into locals, so `dst` may alias `a` or `b`.
 *
 * @category Math
 */
export function mat4Multiply(
  dst: Mat4,
  a: Readonly<Mat4>,
  b: Readonly<Mat4>,
): Mat4 {
  const a00 = a[0]
  const a01 = a[1]
  const a02 = a[2]
  const a03 = a[3]
  const a10 = a[4]
  const a11 = a[5]
  const a12 = a[6]
  const a13 = a[7]
  const a20 = a[8]
  const a21 = a[9]
  const a22 = a[10]
  const a23 = a[11]
  const a30 = a[12]
  const a31 = a[13]
  const a32 = a[14]
  const a33 = a[15]

  for (let i = 0; i < 4; i++) {
    const b0 = b[i * 4]
    const b1 = b[i * 4 + 1]
    const b2 = b[i * 4 + 2]
    const b3 = b[i * 4 + 3]
    dst[i * 4] = a00 * b0 + a10 * b1 + a20 * b2 + a30 * b3
    dst[i * 4 + 1] = a01 * b0 + a11 * b1 + a21 * b2 + a31 * b3
    dst[i * 4 + 2] = a02 * b0 + a12 * b1 + a22 * b2 + a32 * b3
    dst[i * 4 + 3] = a03 * b0 + a13 * b1 + a23 * b2 + a33 * b3
  }
  return dst
}

/**
 * Inverse of `src`, `dst = inv(src)`. Reads into locals, so `dst` may alias
 * `src`. Returns `false` and leaves `dst` an identity matrix when `src` is
 * singular (zero determinant).
 *
 * @category Math
 */
export function mat4Invert(dst: Mat4, src: Readonly<Mat4>): boolean {
  const a00 = src[0]
  const a01 = src[1]
  const a02 = src[2]
  const a03 = src[3]
  const a10 = src[4]
  const a11 = src[5]
  const a12 = src[6]
  const a13 = src[7]
  const a20 = src[8]
  const a21 = src[9]
  const a22 = src[10]
  const a23 = src[11]
  const a30 = src[12]
  const a31 = src[13]
  const a32 = src[14]
  const a33 = src[15]

  const b00 = a00 * a11 - a01 * a10
  const b01 = a00 * a12 - a02 * a10
  const b02 = a00 * a13 - a03 * a10
  const b03 = a01 * a12 - a02 * a11
  const b04 = a01 * a13 - a03 * a11
  const b05 = a02 * a13 - a03 * a12
  const b06 = a20 * a31 - a21 * a30
  const b07 = a20 * a32 - a22 * a30
  const b08 = a20 * a33 - a23 * a30
  const b09 = a21 * a32 - a22 * a31
  const b10 = a21 * a33 - a23 * a31
  const b11 = a22 * a33 - a23 * a32

  const det =
    b00 * b11 - b01 * b10 + b02 * b09 + b03 * b08 - b04 * b07 + b05 * b06
  if (det === 0) {
    mat4Identity(dst)
    return false
  }
  const invDet = 1 / det

  dst[0] = (a11 * b11 - a12 * b10 + a13 * b09) * invDet
  dst[1] = (a02 * b10 - a01 * b11 - a03 * b09) * invDet
  dst[2] = (a31 * b05 - a32 * b04 + a33 * b03) * invDet
  dst[3] = (a22 * b04 - a21 * b05 - a23 * b03) * invDet
  dst[4] = (a12 * b08 - a10 * b11 - a13 * b07) * invDet
  dst[5] = (a00 * b11 - a02 * b08 + a03 * b07) * invDet
  dst[6] = (a32 * b02 - a30 * b05 - a33 * b01) * invDet
  dst[7] = (a20 * b05 - a22 * b02 + a23 * b01) * invDet
  dst[8] = (a10 * b10 - a11 * b08 + a13 * b06) * invDet
  dst[9] = (a01 * b08 - a00 * b10 - a03 * b06) * invDet
  dst[10] = (a30 * b04 - a31 * b02 + a33 * b00) * invDet
  dst[11] = (a21 * b02 - a20 * b04 - a23 * b00) * invDet
  dst[12] = (a11 * b07 - a10 * b09 - a12 * b06) * invDet
  dst[13] = (a00 * b09 - a01 * b07 + a02 * b06) * invDet
  dst[14] = (a31 * b01 - a30 * b03 - a32 * b00) * invDet
  dst[15] = (a20 * b03 - a21 * b01 + a22 * b00) * invDet
  return true
}

/**
 * Depth-clip convention for a projection. `'neg-one-to-one'` maps clip-space
 * `z` into `[-1, 1]` (WebGL's NDC depth range); `'zero-to-one'` into `[0, 1]`
 * (WebGPU's). The backend picks it (a WebGPU projection must land depth in `[0,
 * 1]` or near geometry is clipped), so the camera reads it from the device.
 *
 * @category Math
 */
export type ClipDepth = 'neg-one-to-one' | 'zero-to-one'

/**
 * Right-handed perspective projection with a symmetric frustum. `fovY` is the
 * vertical field of view in radians; `aspect` is width / height. `far` may be
 * `Infinity` for an infinite far plane. `clipDepth` selects the NDC depth range
 * (default `'neg-one-to-one'`, WebGL); only the `z` row differs between the
 * two.
 *
 * @category Math
 */
export function mat4Perspective(
  dst: Mat4,
  fovY: number,
  aspect: number,
  near: number,
  far: number,
  clipDepth: ClipDepth = 'neg-one-to-one',
): Mat4 {
  const f = 1 / Math.tan(fovY / 2)
  const zeroToOne = clipDepth === 'zero-to-one'
  dst[0] = f / aspect
  dst[1] = 0
  dst[2] = 0
  dst[3] = 0
  dst[4] = 0
  dst[5] = f
  dst[6] = 0
  dst[7] = 0
  dst[8] = 0
  dst[9] = 0
  dst[11] = -1
  dst[12] = 0
  dst[13] = 0
  dst[15] = 0
  if (far === Infinity) {
    dst[10] = -1
    dst[14] = zeroToOne ? -near : -2 * near
  } else {
    const nf = 1 / (near - far)
    dst[10] = (zeroToOne ? far : far + near) * nf
    dst[14] = (zeroToOne ? 1 : 2) * far * near * nf
  }
  return dst
}

/**
 * Right-handed orthographic projection mapping the box `[left, right] ×
 * [bottom, top] × [near, far]` (camera space) into clip space. `clipDepth`
 * selects the NDC depth range (default `'neg-one-to-one'`, WebGL); only the `z`
 * row differs.
 *
 * @category Math
 */
export function mat4Ortho(
  dst: Mat4,
  left: number,
  right: number,
  bottom: number,
  top: number,
  near: number,
  far: number,
  clipDepth: ClipDepth = 'neg-one-to-one',
): Mat4 {
  const lr = 1 / (left - right)
  const bt = 1 / (bottom - top)
  const nf = 1 / (near - far)
  const zeroToOne = clipDepth === 'zero-to-one'
  dst[0] = -2 * lr
  dst[1] = 0
  dst[2] = 0
  dst[3] = 0
  dst[4] = 0
  dst[5] = -2 * bt
  dst[6] = 0
  dst[7] = 0
  dst[8] = 0
  dst[9] = 0
  dst[10] = (zeroToOne ? 1 : 2) * nf
  dst[11] = 0
  dst[12] = (left + right) * lr
  dst[13] = (top + bottom) * bt
  dst[14] = (zeroToOne ? near : far + near) * nf
  dst[15] = 1
  return dst
}

/**
 * Right-handed view matrix that places the camera at `eye` looking at `center`
 * with the given `up`. Degenerate inputs (eye at center) yield the identity.
 *
 * @category Math
 */
export function mat4LookAt(
  dst: Mat4,
  eye: Readonly<Vec3>,
  center: Readonly<Vec3>,
  up: Readonly<Vec3>,
): Mat4 {
  let z0 = eye.x - center.x
  let z1 = eye.y - center.y
  let z2 = eye.z - center.z
  let zLen = Math.hypot(z0, z1, z2)
  if (zLen === 0) return mat4Identity(dst)
  zLen = 1 / zLen
  z0 *= zLen
  z1 *= zLen
  z2 *= zLen

  let x0 = up.y * z2 - up.z * z1
  let x1 = up.z * z0 - up.x * z2
  let x2 = up.x * z1 - up.y * z0
  let xLen = Math.hypot(x0, x1, x2)
  if (xLen === 0) {
    x0 = 0
    x1 = 0
    x2 = 0
  } else {
    xLen = 1 / xLen
    x0 *= xLen
    x1 *= xLen
    x2 *= xLen
  }

  const y0 = z1 * x2 - z2 * x1
  const y1 = z2 * x0 - z0 * x2
  const y2 = z0 * x1 - z1 * x0

  dst[0] = x0
  dst[1] = y0
  dst[2] = z0
  dst[3] = 0
  dst[4] = x1
  dst[5] = y1
  dst[6] = z1
  dst[7] = 0
  dst[8] = x2
  dst[9] = y2
  dst[10] = z2
  dst[11] = 0
  dst[12] = -(x0 * eye.x + x1 * eye.y + x2 * eye.z)
  dst[13] = -(y0 * eye.x + y1 * eye.y + y2 * eye.z)
  dst[14] = -(z0 * eye.x + z1 * eye.y + z2 * eye.z)
  dst[15] = 1
  return dst
}

/**
 * Compose a transform matrix from a translation, a rotation quaternion, and a
 * per-axis scale, applied to a point as translate × rotate × scale (scale
 * first). `q` need not be normalized, but a non-unit quaternion bakes an extra
 * scale into the rotation.
 *
 * @category Math
 */
export function mat4Compose(
  dst: Mat4,
  position: Readonly<Vec3>,
  q: Readonly<Quat>,
  scale: Readonly<Vec3>,
): Mat4 {
  const x = q.x
  const y = q.y
  const z = q.z
  const w = q.w
  const x2 = x + x
  const y2 = y + y
  const z2 = z + z
  const xx = x * x2
  const xy = x * y2
  const xz = x * z2
  const yy = y * y2
  const yz = y * z2
  const zz = z * z2
  const wx = w * x2
  const wy = w * y2
  const wz = w * z2
  const sx = scale.x
  const sy = scale.y
  const sz = scale.z

  dst[0] = (1 - (yy + zz)) * sx
  dst[1] = (xy + wz) * sx
  dst[2] = (xz - wy) * sx
  dst[3] = 0
  dst[4] = (xy - wz) * sy
  dst[5] = (1 - (xx + zz)) * sy
  dst[6] = (yz + wx) * sy
  dst[7] = 0
  dst[8] = (xz + wy) * sz
  dst[9] = (yz - wx) * sz
  dst[10] = (1 - (xx + yy)) * sz
  dst[11] = 0
  dst[12] = position.x
  dst[13] = position.y
  dst[14] = position.z
  dst[15] = 1
  return dst
}

/**
 * Transform the point `(x, y, z)` (implicit `w = 1`) by `m` with a perspective
 * divide, into `dst`. Use for projecting a world point through a view-proj
 * matrix. A zero `w` is treated as `1` to avoid `NaN`.
 *
 * @category Math
 */
export function mat4TransformPoint(
  dst: Vec3,
  m: Readonly<Mat4>,
  x: number,
  y: number,
  z: number,
): Vec3 {
  let w = m[3] * x + m[7] * y + m[11] * z + m[15]
  if (w === 0) w = 1
  const inv = 1 / w
  dst.x = (m[0] * x + m[4] * y + m[8] * z + m[12]) * inv
  dst.y = (m[1] * x + m[5] * y + m[9] * z + m[13]) * inv
  dst.z = (m[2] * x + m[6] * y + m[10] * z + m[14]) * inv
  return dst
}

/**
 * Transform the direction `(x, y, z)` (implicit `w = 0`) by `m`, into `dst` —
 * the translation column is ignored and there is no perspective divide.
 *
 * @category Math
 */
export function mat4TransformDir(
  dst: Vec3,
  m: Readonly<Mat4>,
  x: number,
  y: number,
  z: number,
): Vec3 {
  dst.x = m[0] * x + m[4] * y + m[8] * z
  dst.y = m[1] * x + m[5] * y + m[9] * z
  dst.z = m[2] * x + m[6] * y + m[10] * z
  return dst
}
