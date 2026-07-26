/**
 * A 3×3 matrix stored column-major in a `Float32Array(9)`, matching WebGL's
 * `uniformMatrix3fv(..., false, m)` layout so a `Mat3` uploads without a
 * transpose. Element `(row, col)` lives at index `col * 3 + row`.
 *
 * Like the `mat4*` helpers, the `mat3*` functions take a destination `dst`
 * first, write into it, and return it, so per-frame math need not allocate.
 *
 * @category Math
 */
export type Mat3 = Float32Array

import type { Mat4 } from './Mat4'

/**
 * Create a new identity matrix.
 *
 * @category Math
 */
export function mat3(): Mat3 {
  const m = new Float32Array(9)
  m[0] = 1
  m[4] = 1
  m[8] = 1
  return m
}

/**
 * Normal matrix for `model`: the inverse-transpose of its upper-left 3×3, into
 * `dst`. A surface normal transformed by this stays perpendicular to the
 * surface under non-uniform scale, where the plain upper 3×3 (`mat3(model)`)
 * skews it; rotation and uniform scale are unaffected up to a uniform length
 * the shader normalizes away. Falls back to the plain upper 3×3 when the linear
 * part is singular (zero determinant). `dst` may not alias `model`.
 *
 * @category Math
 */
export function mat3NormalMatrix(dst: Mat3, model: Readonly<Mat4>): Mat3 {
  // Upper-left 3×3 of the column-major 4×4: (row, col) at col*4 + row.
  const a00 = model[0],
    a10 = model[1],
    a20 = model[2]
  const a01 = model[4],
    a11 = model[5],
    a21 = model[6]
  const a02 = model[8],
    a12 = model[9],
    a22 = model[10]

  // Cofactors of the 3×3. The inverse-transpose equals the cofactor matrix
  // divided by the determinant, so `dst(r,c) = cofactor(r,c) / det`.
  const c00 = a11 * a22 - a12 * a21
  const c01 = a12 * a20 - a10 * a22
  const c02 = a10 * a21 - a11 * a20
  const det = a00 * c00 + a01 * c01 + a02 * c02
  if (det === 0) {
    dst[0] = a00
    dst[1] = a10
    dst[2] = a20
    dst[3] = a01
    dst[4] = a11
    dst[5] = a21
    dst[6] = a02
    dst[7] = a12
    dst[8] = a22
    return dst
  }
  const c10 = a02 * a21 - a01 * a22
  const c11 = a00 * a22 - a02 * a20
  const c12 = a01 * a20 - a00 * a21
  const c20 = a01 * a12 - a02 * a11
  const c21 = a02 * a10 - a00 * a12
  const c22 = a00 * a11 - a01 * a10
  const invDet = 1 / det

  // Column-major: dst[col*3 + row] = cofactor(row, col) / det.
  dst[0] = c00 * invDet
  dst[1] = c10 * invDet
  dst[2] = c20 * invDet
  dst[3] = c01 * invDet
  dst[4] = c11 * invDet
  dst[5] = c21 * invDet
  dst[6] = c02 * invDet
  dst[7] = c12 * invDet
  dst[8] = c22 * invDet
  return dst
}
