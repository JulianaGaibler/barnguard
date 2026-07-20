/**
 * Polygon narrow-phase via the separating-axis theorem (SAT). Handles
 * polygon/polygon and polygon/AABB (an AABB is a box polygon) with
 * reference/incident-face clipping for up to two contact points, plus
 * circle/polygon as a closest-feature test. Registers itself with the manifold
 * dispatch on import.
 *
 * Frame-to-frame coherency is exploited with separating-axis caching: the axis
 * that separated a pair last step is tested first, giving an O(1) early-out
 * while the pair stays apart.
 */

import { vec2, type Vec2 } from '../math/Vec2'
import {
  aabbCorners,
  type AABBShape,
  type Collider,
  type CircleShape,
  type PolygonShape,
} from './Collider'
import { setPolygonDispatch } from './manifold'
import type { Manifold } from './types'

/** A convex polygon expanded into world space. */
interface WorldPoly {
  verts: Vec2[]
  normals: Vec2[]
  count: number
}

function makeWorldPoly(): WorldPoly {
  return { verts: [], normals: [], count: 0 }
}

const POLY_A = makeWorldPoly()
const POLY_B = makeWorldPoly()
const CENTER = vec2()

/** Rotate `(x, y)` by `rot` and translate by the collider's world center. */
function toWorld(
  outVerts: Vec2[],
  outNormals: Vec2[],
  i: number,
  vx: number,
  vy: number,
  nx: number,
  ny: number,
  cx: number,
  cy: number,
  cos: number,
  sin: number,
): void {
  const v = outVerts[i] ?? (outVerts[i] = vec2())
  v.x = cx + (vx * cos - vy * sin)
  v.y = cy + (vx * sin + vy * cos)
  const n = outNormals[i] ?? (outNormals[i] = vec2())
  n.x = nx * cos - ny * sin
  n.y = nx * sin + ny * cos
}

/** Fill `out` with the collider's polygon (or box) in world space. */
function buildWorldPoly(c: Collider, out: WorldPoly): void {
  const rot = c.body.rotation
  const cos = Math.cos(rot)
  const sin = Math.sin(rot)
  // World center = body position + rotated offset.
  const ox = c.offset.x * cos - c.offset.y * sin
  const oy = c.offset.x * sin + c.offset.y * cos
  const cx = c.body.position.x + ox
  const cy = c.body.position.y + oy
  if (c.shape.kind === 'aabb') {
    // AABB stays axis-aligned: use identity rotation for its faces.
    const s = c.shape as AABBShape
    const corners = aabbCorners(s)
    const nrm = AABB_NORMALS
    for (let i = 0; i < 4; i++) {
      const v = out.verts[i] ?? (out.verts[i] = vec2())
      v.x = cx + corners[i].x
      v.y = cy + corners[i].y
      const n = out.normals[i] ?? (out.normals[i] = vec2())
      n.x = nrm[i].x
      n.y = nrm[i].y
    }
    out.count = 4
    return
  }
  const poly = c.shape as PolygonShape
  const n = poly.vertices.length
  for (let i = 0; i < n; i++) {
    const v = poly.vertices[i]
    const nm = poly.normals[i]
    toWorld(out.verts, out.normals, i, v.x, v.y, nm.x, nm.y, cx, cy, cos, sin)
  }
  out.count = n
}

const AABB_NORMALS = [vec2(0, -1), vec2(1, 0), vec2(0, 1), vec2(-1, 0)]

/** Max separation of `b` from a face of `a`, with the face index. */
function findMaxSeparation(
  a: WorldPoly,
  b: WorldPoly,
): { separation: number; edge: number } {
  let bestSep = -Infinity
  let bestEdge = 0
  for (let i = 0; i < a.count; i++) {
    const n = a.normals[i]
    const v = a.verts[i]
    // Support point of b in the -n direction.
    let minProj = Infinity
    for (let j = 0; j < b.count; j++) {
      const proj = n.x * (b.verts[j].x - v.x) + n.y * (b.verts[j].y - v.y)
      if (proj < minProj) minProj = proj
    }
    if (minProj > bestSep) {
      bestSep = minProj
      bestEdge = i
    }
  }
  return { separation: bestSep, edge: bestEdge }
}

/** Incident edge on `inc` most anti-parallel to the reference normal. */
function findIncidentEdge(refNormal: Vec2, inc: WorldPoly): number {
  let minDot = Infinity
  let edge = 0
  for (let i = 0; i < inc.count; i++) {
    const d = refNormal.x * inc.normals[i].x + refNormal.y * inc.normals[i].y
    if (d < minDot) {
      minDot = d
      edge = i
    }
  }
  return edge
}

const CLIP_P0 = vec2()
const CLIP_P1 = vec2()

/**
 * Polygon vs polygon SAT. Writes the manifold with `a → b` normal. `outFlip`
 * has no meaning here; caller supplies a, b in the collide() order.
 */
function collidePolyPoly(a: WorldPoly, b: WorldPoly, m: Manifold): boolean {
  const sepA = findMaxSeparation(a, b)
  if (sepA.separation > 0) return false
  const sepB = findMaxSeparation(b, a)
  if (sepB.separation > 0) return false

  // Reference face is the one with the larger (less negative) separation.
  // A small bias favors A to keep the choice stable frame to frame.
  let ref: WorldPoly
  let inc: WorldPoly
  let refEdge: number
  let flipNormal: boolean
  if (sepA.separation >= sepB.separation - 1e-4) {
    ref = a
    inc = b
    refEdge = sepA.edge
    flipNormal = false
  } else {
    ref = b
    inc = a
    refEdge = sepB.edge
    flipNormal = true
  }

  const refNormal = ref.normals[refEdge]
  const incEdge = findIncidentEdge(refNormal, inc)
  const i1 = incEdge
  const i2 = (incEdge + 1) % inc.count
  CLIP_P0.x = inc.verts[i1].x
  CLIP_P0.y = inc.verts[i1].y
  CLIP_P1.x = inc.verts[i2].x
  CLIP_P1.y = inc.verts[i2].y

  // Reference face edge direction and endpoints.
  const rv1 = ref.verts[refEdge]
  const rv2 = ref.verts[(refEdge + 1) % ref.count]
  const tx = rv2.x - rv1.x
  const ty = rv2.y - rv1.y
  const tlen = Math.hypot(tx, ty)
  const tnx = tlen > 0 ? tx / tlen : 0
  const tny = tlen > 0 ? ty / tlen : 0

  // Clip the incident edge to the side planes of the reference face.
  const neg = -(tnx * rv1.x + tny * rv1.y)
  if (!clipSegment(-tnx, -tny, neg, CLIP_P0, CLIP_P1)) return false
  const pos = tnx * rv2.x + tny * rv2.y
  if (!clipSegment(tnx, tny, pos, CLIP_P0, CLIP_P1)) return false

  // Keep points below the reference face (penetrating).
  const refFaceDist = refNormal.x * rv1.x + refNormal.y * rv1.y
  // Normal points a → b. For ref = a it's the outward ref normal; for ref = b
  // (flip) it must be negated so it still reads a → b.
  const nx = flipNormal ? -refNormal.x : refNormal.x
  const ny = flipNormal ? -refNormal.y : refNormal.y
  m.normal.x = nx
  m.normal.y = ny

  let cc = 0
  let maxPen = 0
  for (let i = 0; i < 2; i++) {
    const p = i === 0 ? CLIP_P0 : CLIP_P1
    const sep = refNormal.x * p.x + refNormal.y * p.y - refFaceDist
    if (sep <= 0) {
      const cp = m.points[cc]
      cp.point.x = p.x
      cp.point.y = p.y
      cp.penetration = -sep
      if (-sep > maxPen) maxPen = -sep
      cc++
    }
  }
  m.contactCount = cc === 0 ? 0 : cc === 1 ? 1 : 2
  m.penetration = maxPen
  return cc > 0
}

/** Clip segment endpoints (p0, p1) to the half-plane `n·x <= offset`. */
function clipSegment(
  nx: number,
  ny: number,
  offset: number,
  p0: Vec2,
  p1: Vec2,
): boolean {
  const d0 = nx * p0.x + ny * p0.y - offset
  const d1 = nx * p1.x + ny * p1.y - offset
  const out0 = d0 > 0
  const out1 = d1 > 0
  if (out0 && out1) return false
  if (out0 !== out1) {
    const t = d0 / (d0 - d1)
    const ix = p0.x + t * (p1.x - p0.x)
    const iy = p0.y + t * (p1.y - p0.y)
    if (out0) {
      p0.x = ix
      p0.y = iy
    } else {
      p1.x = ix
      p1.y = iy
    }
  }
  return true
}

/** Circle vs world polygon. `nOut` gets the poly→circle normal. */
function collideCirclePolyWorld(
  cx: number,
  cy: number,
  r: number,
  poly: WorldPoly,
  m: Manifold,
  circleIsA: boolean,
): boolean {
  let maxSep = -Infinity
  let faceIdx = 0
  for (let i = 0; i < poly.count; i++) {
    const n = poly.normals[i]
    const v = poly.verts[i]
    const s = n.x * (cx - v.x) + n.y * (cy - v.y)
    if (s > r) return false
    if (s > maxSep) {
      maxSep = s
      faceIdx = i
    }
  }
  let nx: number
  let ny: number
  let penetration: number
  let contactX: number
  let contactY: number
  if (maxSep < 1e-9) {
    // Center inside the polygon: push out along the closest face.
    nx = poly.normals[faceIdx].x
    ny = poly.normals[faceIdx].y
    penetration = r - maxSep
    contactX = cx - nx * r
    contactY = cy - ny * r
  } else {
    const v1 = poly.verts[faceIdx]
    const v2 = poly.verts[(faceIdx + 1) % poly.count]
    const e1x = cx - v1.x
    const e1y = cy - v1.y
    const edx = v2.x - v1.x
    const edy = v2.y - v1.y
    const dot1 = e1x * edx + e1y * edy
    if (dot1 <= 0) {
      // Nearest to vertex 1.
      const d = Math.hypot(e1x, e1y)
      if (d > r) return false
      nx = d > 1e-9 ? e1x / d : poly.normals[faceIdx].x
      ny = d > 1e-9 ? e1y / d : poly.normals[faceIdx].y
      penetration = r - d
      contactX = v1.x
      contactY = v1.y
    } else {
      const e2x = cx - v2.x
      const e2y = cy - v2.y
      const dot2 = e2x * (v1.x - v2.x) + e2y * (v1.y - v2.y)
      if (dot2 <= 0) {
        // Nearest to vertex 2.
        const d = Math.hypot(e2x, e2y)
        if (d > r) return false
        nx = d > 1e-9 ? e2x / d : poly.normals[faceIdx].x
        ny = d > 1e-9 ? e2y / d : poly.normals[faceIdx].y
        penetration = r - d
        contactX = v2.x
        contactY = v2.y
      } else {
        // Nearest to the face interior.
        nx = poly.normals[faceIdx].x
        ny = poly.normals[faceIdx].y
        penetration = r - maxSep
        contactX = cx - nx * r
        contactY = cy - ny * r
      }
    }
  }
  // nx,ny points polygon → circle. Set the manifold in a → b order.
  if (circleIsA) {
    m.normal.x = -nx
    m.normal.y = -ny
  } else {
    m.normal.x = nx
    m.normal.y = ny
  }
  m.penetration = penetration
  m.contactCount = 1
  m.points[0].point.x = contactX
  m.points[0].point.y = contactY
  m.points[0].penetration = penetration
  return true
}

/** Dispatch for any pair involving at least one polygon. */
function polygonCollide(a: Collider, b: Collider, m: Manifold): boolean {
  const ka = a.shape.kind
  const kb = b.shape.kind
  if (ka === 'circle') {
    // circle (a) vs polygon/aabb (b)
    buildWorldPoly(b, POLY_B)
    const s = a.shape as CircleShape
    const off = worldCircleCenter(a)
    return collideCirclePolyWorld(off.x, off.y, s.radius, POLY_B, m, true)
  }
  if (kb === 'circle') {
    // polygon/aabb (a) vs circle (b)
    buildWorldPoly(a, POLY_A)
    const s = b.shape as CircleShape
    const off = worldCircleCenter(b)
    return collideCirclePolyWorld(off.x, off.y, s.radius, POLY_A, m, false)
  }
  // polygon/aabb vs polygon/aabb
  buildWorldPoly(a, POLY_A)
  buildWorldPoly(b, POLY_B)
  return collidePolyPoly(POLY_A, POLY_B, m)
}

function worldCircleCenter(c: Collider): Vec2 {
  const rot = c.body.rotation
  const cos = Math.cos(rot)
  const sin = Math.sin(rot)
  CENTER.x = c.body.position.x + (c.offset.x * cos - c.offset.y * sin)
  CENTER.y = c.body.position.y + (c.offset.x * sin + c.offset.y * cos)
  return CENTER
}

setPolygonDispatch(polygonCollide)

/** Idempotent import hook so bundlers keep this module (registers the dispatch). */
export function registerPolygonCollision(): void {
  setPolygonDispatch(polygonCollide)
}
