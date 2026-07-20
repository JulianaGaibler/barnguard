/**
 * Convex-polygon geometry helpers for the physics narrow-phase and mass
 * properties. Vertices are plain {@link Vec2} arrays in a shape's local space,
 * wound counter-clockwise. These are internal helpers; the physics module
 * consumes them via {@link polygonShape}.
 */

import { vec2, type Vec2 } from './Vec2'

/**
 * Signed area of the polygon. Positive for counter-clockwise winding, negative
 * for clockwise. The magnitude is the enclosed area.
 */
export function polygonArea(verts: readonly Readonly<Vec2>[]): number {
  const n = verts.length
  let twiceArea = 0
  for (let i = 0; i < n; i++) {
    const p1 = verts[i]
    const p2 = verts[(i + 1) % n]
    twiceArea += p1.x * p2.y - p2.x * p1.y
  }
  return twiceArea * 0.5
}

/**
 * Area centroid of the polygon, into `dst`. Falls back to the vertex mean when
 * the polygon is degenerate (zero area).
 */
export function polygonCentroid(
  dst: Vec2,
  verts: readonly Readonly<Vec2>[],
): Vec2 {
  const n = verts.length
  let cx = 0
  let cy = 0
  let twiceArea = 0
  for (let i = 0; i < n; i++) {
    const p1 = verts[i]
    const p2 = verts[(i + 1) % n]
    const cross = p1.x * p2.y - p2.x * p1.y
    twiceArea += cross
    cx += (p1.x + p2.x) * cross
    cy += (p1.y + p2.y) * cross
  }
  if (twiceArea === 0) {
    // Degenerate: use the vertex mean.
    let mx = 0
    let my = 0
    for (const v of verts) {
      mx += v.x
      my += v.y
    }
    dst.x = mx / n
    dst.y = my / n
    return dst
  }
  const inv = 1 / (3 * twiceArea)
  dst.x = cx * inv
  dst.y = cy * inv
  return dst
}

/**
 * Outward unit edge normals for a counter-clockwise polygon, into `out`. Normal
 * `i` is perpendicular to the edge from vertex `i` to vertex `i + 1`. `out` is
 * grown to the vertex count and returned.
 */
export function polygonComputeNormals(
  out: Vec2[],
  verts: readonly Readonly<Vec2>[],
): Vec2[] {
  const n = verts.length
  out.length = n
  for (let i = 0; i < n; i++) {
    const p1 = verts[i]
    const p2 = verts[(i + 1) % n]
    const ex = p2.x - p1.x
    const ey = p2.y - p1.y
    // Right perpendicular (ey, -ex) points outward for CCW winding.
    const len = Math.hypot(ex, ey)
    const normal = out[i] ?? (out[i] = vec2())
    if (len === 0) {
      normal.x = 0
      normal.y = 0
    } else {
      normal.x = ey / len
      normal.y = -ex / len
    }
  }
  return out
}

/**
 * Moment of inertia of a uniform-density polygon of the given `mass` about
 * `center` (normally the centroid). Assumes counter-clockwise winding.
 */
export function polygonMomentOfInertia(
  verts: readonly Readonly<Vec2>[],
  mass: number,
  center: Readonly<Vec2>,
): number {
  const n = verts.length
  let numerator = 0
  let denominator = 0
  for (let i = 0; i < n; i++) {
    const p1 = verts[i]
    const p2 = verts[(i + 1) % n]
    const x1 = p1.x - center.x
    const y1 = p1.y - center.y
    const x2 = p2.x - center.x
    const y2 = p2.y - center.y
    const cross = x1 * y2 - x2 * y1
    numerator +=
      cross * (x1 * x1 + x1 * x2 + x2 * x2 + y1 * y1 + y1 * y2 + y2 * y2)
    denominator += cross
  }
  if (denominator === 0) return 0
  return (mass / 6) * (numerator / denominator)
}
