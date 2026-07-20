/**
 * Ray casting against colliders. Each function takes a ray with a normalized
 * direction and returns the distance `t` to the first hit (or -1 for a miss),
 * writing the surface normal into `outNormal`. {@link PhysicsWorld.raycast}
 * culls candidates through the broad-phase and picks the nearest hit.
 */

import { vec2, vec2Rotate, type Vec2 } from '../math/Vec2'
import type { Collider } from './Collider'
import type { AABBShape, CircleShape, PolygonShape } from './Collider'

const SCRATCH_CENTER = vec2()
const SCRATCH_LOCAL_O = vec2()
const SCRATCH_LOCAL_D = vec2()
const SCRATCH_LOCAL_N = vec2()

/** World-space center of a collider (body position plus rotated offset). */
function worldCenter(c: Collider, out: Vec2): Vec2 {
  const off = vec2Rotate(out, c.offset, c.body.rotation)
  out.x = c.body.position.x + off.x
  out.y = c.body.position.y + off.y
  return out
}

/**
 * Ray vs collider. `dx,dy` must be a unit direction; `t` is the world distance
 * to the hit. Returns -1 on a miss. Writes the surface normal into
 * `outNormal`.
 */
export function rayVsCollider(
  ox: number,
  oy: number,
  dx: number,
  dy: number,
  maxT: number,
  c: Collider,
  outNormal: Vec2,
): number {
  switch (c.shape.kind) {
    case 'circle':
      return rayVsCircle(ox, oy, dx, dy, maxT, c, outNormal)
    case 'aabb':
      return rayVsAABB(ox, oy, dx, dy, maxT, c, outNormal)
    case 'polygon':
      return rayVsPolygon(ox, oy, dx, dy, maxT, c, outNormal)
  }
}

function rayVsCircle(
  ox: number,
  oy: number,
  dx: number,
  dy: number,
  maxT: number,
  c: Collider,
  outNormal: Vec2,
): number {
  const r = (c.shape as CircleShape).radius
  const center = worldCenter(c, SCRATCH_CENTER)
  const mx = ox - center.x
  const my = oy - center.y
  const b = mx * dx + my * dy
  const cc = mx * mx + my * my - r * r
  if (cc > 0 && b > 0) return -1
  const disc = b * b - cc
  if (disc < 0) return -1
  let t = -b - Math.sqrt(disc)
  if (t < 0) t = 0
  if (t > maxT) return -1
  const hx = ox + dx * t
  const hy = oy + dy * t
  let nx = hx - center.x
  let ny = hy - center.y
  const len = Math.hypot(nx, ny)
  if (len > 1e-9) {
    nx /= len
    ny /= len
  } else {
    nx = -dx
    ny = -dy
  }
  outNormal.x = nx
  outNormal.y = ny
  return t
}

function rayVsAABB(
  ox: number,
  oy: number,
  dx: number,
  dy: number,
  maxT: number,
  c: Collider,
  outNormal: Vec2,
): number {
  const shape = c.shape as AABBShape
  const center = worldCenter(c, SCRATCH_CENTER)
  const minX = center.x - shape.halfW
  const maxX = center.x + shape.halfW
  const minY = center.y - shape.halfH
  const maxY = center.y + shape.halfH
  let tmin = -Infinity
  let tmax = Infinity
  let nxAtMin = 0
  let nyAtMin = 0
  if (dx !== 0) {
    const inv = 1 / dx
    let t1 = (minX - ox) * inv
    let t2 = (maxX - ox) * inv
    let n1 = -1
    if (t1 > t2) {
      const tmp = t1
      t1 = t2
      t2 = tmp
      n1 = 1
    }
    if (t1 > tmin) {
      tmin = t1
      nxAtMin = n1
      nyAtMin = 0
    }
    if (t2 < tmax) tmax = t2
  } else if (ox < minX || ox > maxX) {
    return -1
  }
  if (dy !== 0) {
    const inv = 1 / dy
    let t1 = (minY - oy) * inv
    let t2 = (maxY - oy) * inv
    let n1 = -1
    if (t1 > t2) {
      const tmp = t1
      t1 = t2
      t2 = tmp
      n1 = 1
    }
    if (t1 > tmin) {
      tmin = t1
      nxAtMin = 0
      nyAtMin = n1
    }
    if (t2 < tmax) tmax = t2
  } else if (oy < minY || oy > maxY) {
    return -1
  }
  if (tmin > tmax) return -1
  let t = tmin
  if (t < 0) {
    if (tmax < 0) return -1
    // Origin inside the box.
    t = 0
    outNormal.x = -dx
    outNormal.y = -dy
    return t
  }
  if (t > maxT) return -1
  outNormal.x = nxAtMin
  outNormal.y = nyAtMin
  return t
}

function rayVsPolygon(
  ox: number,
  oy: number,
  dx: number,
  dy: number,
  maxT: number,
  c: Collider,
  outNormal: Vec2,
): number {
  const shape = c.shape as PolygonShape
  const center = worldCenter(c, SCRATCH_CENTER)
  const rot = c.body.rotation
  // Transform the ray into the polygon's local frame.
  SCRATCH_LOCAL_O.x = ox - center.x
  SCRATCH_LOCAL_O.y = oy - center.y
  vec2Rotate(SCRATCH_LOCAL_O, SCRATCH_LOCAL_O, -rot)
  SCRATCH_LOCAL_D.x = dx
  SCRATCH_LOCAL_D.y = dy
  vec2Rotate(SCRATCH_LOCAL_D, SCRATCH_LOCAL_D, -rot)
  const lox = SCRATCH_LOCAL_O.x
  const loy = SCRATCH_LOCAL_O.y
  const ldx = SCRATCH_LOCAL_D.x
  const ldy = SCRATCH_LOCAL_D.y

  let tEnter = 0
  let tExit = maxT
  let enterNx = 0
  let enterNy = 0
  const verts = shape.vertices
  const normals = shape.normals
  for (let i = 0; i < verts.length; i++) {
    const n = normals[i]
    const v = verts[i]
    const denom = n.x * ldx + n.y * ldy
    const dist = n.x * (lox - v.x) + n.y * (loy - v.y)
    if (denom === 0) {
      if (dist > 0) return -1 // parallel and outside this edge
      continue
    }
    const t = -dist / denom
    if (denom < 0) {
      // Entering half-plane.
      if (t > tEnter) {
        tEnter = t
        enterNx = n.x
        enterNy = n.y
      }
    } else {
      // Exiting half-plane.
      if (t < tExit) tExit = t
    }
    if (tEnter > tExit) return -1
  }
  if (tEnter > maxT) return -1
  // Rotate the local normal back to world.
  SCRATCH_LOCAL_N.x = enterNx
  SCRATCH_LOCAL_N.y = enterNy
  vec2Rotate(SCRATCH_LOCAL_N, SCRATCH_LOCAL_N, rot)
  outNormal.x = SCRATCH_LOCAL_N.x
  outNormal.y = SCRATCH_LOCAL_N.y
  return tEnter
}
