import type { ClipDepth, Mat4 } from './Mat4'

/**
 * The six planes of a view-projection's frustum, `(a, b, c, d)` each, with the
 * normal pointing inward: a point is inside a plane when `a_x + b_y + c*z + d
 *
 * > = 0`. The order is left, right, bottom, top, near, far.
 */
export type FrustumPlanes = Float64Array

/** A new, empty set of frustum planes. */
export function createFrustum(): FrustumPlanes {
  return new Float64Array(24)
}

/**
 * Fill `out` with the planes of the column-major view-projection `m`.
 * `clipDepth` is the depth range the projection maps to, which decides the near
 * plane.
 */
export function frustumFromMatrix(
  out: FrustumPlanes,
  m: Readonly<Mat4>,
  clipDepth: ClipDepth,
): FrustumPlanes {
  // Rows of the matrix: row i is (m[i], m[4 + i], m[8 + i], m[12 + i]).
  const r3x = m[3]
  const r3y = m[7]
  const r3z = m[11]
  const r3w = m[15]
  for (let p = 0; p < 6; p++) {
    const axis = p >> 1
    const sign = p & 1 ? -1 : 1
    let x: number
    let y: number
    let z: number
    let w: number
    if (axis === 2 && sign === 1 && clipDepth === 'zero-to-one') {
      // Depth starts at 0, so the near plane is the depth row alone.
      x = m[2]
      y = m[6]
      z = m[10]
      w = m[14]
    } else {
      x = r3x + sign * m[axis]
      y = r3y + sign * m[4 + axis]
      z = r3z + sign * m[8 + axis]
      w = r3w + sign * m[12 + axis]
    }
    const len = Math.hypot(x, y, z) || 1
    out[p * 4] = x / len
    out[p * 4 + 1] = y / len
    out[p * 4 + 2] = z / len
    out[p * 4 + 3] = w / len
  }
  return out
}

/**
 * Whether the box lies wholly outside one of the planes `first` to `last - 1`.
 * A box that crosses a plane counts as inside, so the test only ever keeps too
 * much.
 */
export function boxOutsideFrustum(
  planes: FrustumPlanes,
  minX: number,
  minY: number,
  minZ: number,
  maxX: number,
  maxY: number,
  maxZ: number,
  first = 0,
  last = 6,
): boolean {
  for (let p = first; p < last; p++) {
    const a = planes[p * 4]
    const b = planes[p * 4 + 1]
    const c = planes[p * 4 + 2]
    const d = planes[p * 4 + 3]
    // The corner furthest along the plane's normal.
    const x = a >= 0 ? maxX : minX
    const y = b >= 0 ? maxY : minY
    const z = c >= 0 ? maxZ : minZ
    if (a * x + b * y + c * z + d < 0) return true
  }
  return false
}
