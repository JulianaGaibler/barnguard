/**
 * Narrow-phase collision detection: given two overlapping colliders, produce a
 * {@link Manifold} with a contact normal (pointing from `a` toward `b`),
 * penetration depth, and contact points. Manifolds come from a pool so the step
 * loop stays allocation-free.
 *
 * This module handles circle and axis-aligned-box pairs. Polygon pairs (SAT)
 * are layered in by the polygon module.
 */

import { vec2, vec2Rotate, type Vec2 } from '../math/Vec2'
import type { Collider } from './Collider'
import type { Contact, Manifold } from './types'

function makeManifold(): Manifold {
  const points: [Contact, Contact] = [
    { point: vec2(), penetration: 0 },
    { point: vec2(), penetration: 0 },
  ]
  return {
    // a/b/colliderA/colliderB are assigned by the world before use.
    a: null as never,
    b: null as never,
    colliderA: null as never,
    colliderB: null as never,
    normal: vec2(),
    penetration: 0,
    contactCount: 0,
    points,
    isSensor: false,
  }
}

/**
 * A fixed-growth pool of {@link Manifold} objects. `begin()` resets the cursor;
 * `next()` hands out a reused manifold. Grows by one when exhausted.
 */
export class ManifoldPool {
  readonly #items: Manifold[] = []
  #cursor = 0

  begin(): void {
    this.#cursor = 0
  }

  next(): Manifold {
    let m = this.#items[this.#cursor]
    if (!m) {
      m = makeManifold()
      this.#items[this.#cursor] = m
    }
    this.#cursor++
    m.contactCount = 0
    m.isSensor = false
    return m
  }
}

/** World-space center of a circle or box collider, into `out`. */
function worldCenter(c: Collider, out: Vec2): Vec2 {
  const off = vec2Rotate(out, c.offset, c.body.rotation)
  out.x = c.body.position.x + off.x
  out.y = c.body.position.y + off.y
  return out
}

const CA = vec2()
const CB = vec2()

/**
 * Fill `m` with the contact between two colliders whose world AABBs overlap.
 * Returns true when they actually touch. The normal points from `a` toward
 * `b`.
 */
export function collide(a: Collider, b: Collider, m: Manifold): boolean {
  const ka = a.shape.kind
  const kb = b.shape.kind
  if (ka === 'circle' && kb === 'circle') {
    return collideCircleCircle(a, b, m)
  }
  if (ka === 'circle' && kb === 'aabb') {
    return collideCircleAABB(a, b, m, false)
  }
  if (ka === 'aabb' && kb === 'circle') {
    return collideCircleAABB(b, a, m, true)
  }
  if (ka === 'aabb' && kb === 'aabb') {
    return collideAABB_AABB(a, b, m)
  }
  // Polygon pairs are handled by the polygon module, wired in by the world.
  return polygonDispatch(a, b, m)
}

/** Overridable hook so the polygon module can extend the dispatch. */
export let polygonDispatch: (
  a: Collider,
  b: Collider,
  m: Manifold,
) => boolean = () => false

/** Register the polygon narrow-phase (called once by the polygon module). */
export function setPolygonDispatch(
  fn: (a: Collider, b: Collider, m: Manifold) => boolean,
): void {
  polygonDispatch = fn
}

function collideCircleCircle(a: Collider, b: Collider, m: Manifold): boolean {
  const ra = (a.shape as { radius: number }).radius
  const rb = (b.shape as { radius: number }).radius
  worldCenter(a, CA)
  worldCenter(b, CB)
  const dx = CB.x - CA.x
  const dy = CB.y - CA.y
  const distSq = dx * dx + dy * dy
  const r = ra + rb
  if (distSq >= r * r) return false
  let dist = Math.sqrt(distSq)
  let nx: number
  let ny: number
  if (dist > 1e-9) {
    nx = dx / dist
    ny = dy / dist
  } else {
    // Exact overlap: pick a deterministic escape axis.
    nx = 1
    ny = 0
    dist = 0
  }
  const penetration = r - dist
  m.normal.x = nx
  m.normal.y = ny
  m.penetration = penetration
  m.contactCount = 1
  // Contact on the surface midway through the overlap.
  m.points[0].point.x = CA.x + nx * (ra - penetration * 0.5)
  m.points[0].point.y = CA.y + ny * (ra - penetration * 0.5)
  m.points[0].penetration = penetration
  return true
}

/**
 * Circle (`circleCol`) vs axis-aligned box (`boxCol`). Computes the normal from
 * circle toward box; `flip` negates it so the result reads `a → b` when the box
 * was `a`.
 */
function collideCircleAABB(
  circleCol: Collider,
  boxCol: Collider,
  m: Manifold,
  flip: boolean,
): boolean {
  const r = (circleCol.shape as { radius: number }).radius
  const box = boxCol.shape as { halfW: number; halfH: number }
  worldCenter(circleCol, CA)
  worldCenter(boxCol, CB)
  const dx = CA.x - CB.x
  const dy = CA.y - CB.y
  const cx = Math.max(-box.halfW, Math.min(box.halfW, dx))
  const cy = Math.max(-box.halfH, Math.min(box.halfH, dy))
  const inside = dx === cx && dy === cy
  let nx: number
  let ny: number
  let penetration: number
  let closestX: number
  let closestY: number
  if (inside) {
    // Center inside (or on the face of) the box: push out the nearest face.
    // The overlap to clear along each axis is `half - |offset|`; the smaller
    // one is the exit direction. Normal points circle → box along that axis.
    const ox = box.halfW - Math.abs(dx)
    const oy = box.halfH - Math.abs(dy)
    if (ox < oy) {
      nx = dx >= 0 ? -1 : 1
      ny = 0
      penetration = r + ox
      closestX = CB.x + (dx >= 0 ? box.halfW : -box.halfW)
      closestY = CA.y
    } else {
      nx = 0
      ny = dy >= 0 ? -1 : 1
      penetration = r + oy
      closestX = CA.x
      closestY = CB.y + (dy >= 0 ? box.halfH : -box.halfH)
    }
  } else {
    closestX = CB.x + cx
    closestY = CB.y + cy
    // Vector from circle center to the closest box point.
    const sx = closestX - CA.x
    const sy = closestY - CA.y
    const dist = Math.hypot(sx, sy)
    if (dist > r) return false
    if (dist > 1e-9) {
      nx = sx / dist
      ny = sy / dist
    } else {
      nx = 0
      ny = 1
    }
    penetration = r - dist
  }
  if (flip) {
    nx = -nx
    ny = -ny
  }
  m.normal.x = nx
  m.normal.y = ny
  m.penetration = penetration
  m.contactCount = 1
  m.points[0].point.x = closestX
  m.points[0].point.y = closestY
  m.points[0].penetration = penetration
  return true
}

function collideAABB_AABB(a: Collider, b: Collider, m: Manifold): boolean {
  const ba = a.shape as { halfW: number; halfH: number }
  const bb = b.shape as { halfW: number; halfH: number }
  worldCenter(a, CA)
  worldCenter(b, CB)
  const dx = CB.x - CA.x
  const dy = CB.y - CA.y
  const overlapX = ba.halfW + bb.halfW - Math.abs(dx)
  if (overlapX <= 0) return false
  const overlapY = ba.halfH + bb.halfH - Math.abs(dy)
  if (overlapY <= 0) return false
  if (overlapX < overlapY) {
    const nx = dx >= 0 ? 1 : -1
    m.normal.x = nx
    m.normal.y = 0
    m.penetration = overlapX
    // Contact on the shared face, mid-height of the overlap region.
    m.points[0].point.x = CA.x + nx * ba.halfW
    m.points[0].point.y = (CA.y + CB.y) * 0.5
  } else {
    const ny = dy >= 0 ? 1 : -1
    m.normal.x = 0
    m.normal.y = ny
    m.penetration = overlapY
    m.points[0].point.x = (CA.x + CB.x) * 0.5
    m.points[0].point.y = CA.y + ny * ba.halfH
  }
  m.contactCount = 1
  m.points[0].penetration = m.penetration
  return true
}
