import { describe, expect, it } from 'vitest'
import { PhysicsWorld } from './PhysicsWorld'
import { BodyType } from './types'
import { circleShape, aabbShape, polygonShape } from './Collider'
import { collide } from './manifold'
import './polygonCollision'
import { Body } from './Body'
import { vec2 } from '../math/Vec2'

const DT = 1 / 120

// A box built as a convex polygon (CCW).
function boxPoly(hw: number, hh: number) {
  return polygonShape([
    vec2(-hw, -hh),
    vec2(hw, -hh),
    vec2(hw, hh),
    vec2(-hw, hh),
  ])
}

function makeManifold() {
  return {
    a: null as never,
    b: null as never,
    colliderA: null as never,
    colliderB: null as never,
    normal: vec2(),
    penetration: 0,
    contactCount: 0 as 0 | 1 | 2,
    points: [
      { point: vec2(), penetration: 0 },
      { point: vec2(), penetration: 0 },
    ] as [
      { point: ReturnType<typeof vec2>; penetration: number },
      { point: ReturnType<typeof vec2>; penetration: number },
    ],
    isSensor: false,
  }
}

describe('polygon SAT narrow-phase', () => {
  it('two overlapping boxes report the min-axis normal and 2 contacts', () => {
    const a = new Body({
      position: { x: 0, y: 0 },
      colliders: [{ shape: boxPoly(10, 10) }],
    })
    const b = new Body({
      position: { x: 15, y: 0 },
      colliders: [{ shape: boxPoly(10, 10) }],
    })
    const m = makeManifold() as never
    const hit = collide(a.colliders[0], b.colliders[0], m)
    expect(hit).toBe(true)
    const mm = m as ReturnType<typeof makeManifold>
    // Overlap of 5 along x; normal points a → b (+x).
    expect(Math.abs(mm.normal.x)).toBeCloseTo(1, 3)
    expect(mm.normal.y).toBeCloseTo(0, 3)
    expect(mm.penetration).toBeCloseTo(5, 3)
    expect(mm.contactCount).toBeGreaterThanOrEqual(1)
  })

  it('separated boxes do not collide', () => {
    const a = new Body({
      position: { x: 0, y: 0 },
      colliders: [{ shape: boxPoly(10, 10) }],
    })
    const b = new Body({
      position: { x: 40, y: 0 },
      colliders: [{ shape: boxPoly(10, 10) }],
    })
    const m = makeManifold() as never
    expect(collide(a.colliders[0], b.colliders[0], m)).toBe(false)
  })

  it('circle vs polygon face', () => {
    const poly = new Body({
      position: { x: 0, y: 0 },
      colliders: [{ shape: boxPoly(10, 10) }],
    })
    const circle = new Body({
      position: { x: 18, y: 0 },
      colliders: [{ shape: circleShape(10) }],
    })
    const m = makeManifold() as never
    expect(collide(circle.colliders[0], poly.colliders[0], m)).toBe(true)
    const mm = m as ReturnType<typeof makeManifold>
    // circle is a → normal points circle → poly (−x).
    expect(mm.normal.x).toBeCloseTo(-1, 2)
    expect(mm.penetration).toBeCloseTo(2, 2)
  })

  it('polygon vs AABB', () => {
    const poly = new Body({
      position: { x: 0, y: 0 },
      colliders: [{ shape: boxPoly(10, 10) }],
    })
    const box = new Body({
      position: { x: 15, y: 0 },
      colliders: [{ shape: aabbShape(10, 10) }],
    })
    const m = makeManifold() as never
    expect(collide(poly.colliders[0], box.colliders[0], m)).toBe(true)
  })
})

describe('polygon dynamics', () => {
  it('a box falls and comes to rest flat on a static floor', () => {
    const world = new PhysicsWorld({ gravity: { x: 0, y: 500 } })
    world.createBody({
      type: BodyType.Static,
      position: { x: 0, y: 100 },
      colliders: [{ shape: aabbShape(200, 10) }],
    })
    const box = world.createBody({
      position: { x: 0, y: 0 },
      restitution: 0,
      colliders: [{ shape: boxPoly(10, 10) }],
    })
    for (let i = 0; i < 800; i++) world.step(DT)
    // Floor top y=90; box half-height 10 → center rests near y=80.
    expect(box.position.y).toBeGreaterThan(75)
    expect(box.position.y).toBeLessThan(85)
    // It should be roughly level (not tumbled).
    expect(Math.abs(Math.sin(box.rotation))).toBeLessThan(0.2)
  })
})

describe('kinematic movement', () => {
  it('moveAndCollide stops at a wall and reports the normal', () => {
    const world = new PhysicsWorld()
    world.createBody({
      type: BodyType.Static,
      position: { x: 50, y: 0 },
      colliders: [{ shape: aabbShape(10, 100) }],
    })
    const mover = world.createBody({
      type: BodyType.Kinematic,
      position: { x: 0, y: 0 },
      colliders: [{ shape: circleShape(5) }],
    })
    const hit = world.moveAndCollide(mover, 100, 0)
    expect(hit).not.toBeNull()
    // Wall left face at x=40; mover radius 5 → rests near x=35.
    expect(mover.position.x).toBeLessThan(40)
    expect(hit!.normal.x).toBeCloseTo(-1, 2)
  })

  it('moveAndSlide slides along a wall', () => {
    const world = new PhysicsWorld()
    world.createBody({
      type: BodyType.Static,
      position: { x: 50, y: 0 },
      colliders: [{ shape: aabbShape(10, 200) }],
    })
    const mover = world.createBody({
      type: BodyType.Kinematic,
      position: { x: 0, y: 0 },
      colliders: [{ shape: circleShape(5) }],
    })
    // Move diagonally into the wall; the x is blocked, the y should slide.
    world.moveAndSlide(mover, 100, 50)
    expect(mover.position.x).toBeLessThan(40)
    expect(mover.position.y).toBeGreaterThan(20)
  })
})
