import { describe, expect, it } from 'vitest'
import { PhysicsWorld } from './PhysicsWorld'
import { circleShape, aabbShape, polygonShape } from './Collider'
import { vec2 } from '../math/Vec2'

describe('raycast vs circle', () => {
  it('hits a circle ahead and reports point, normal, distance', () => {
    const world = new PhysicsWorld()
    world.createBody({
      position: { x: 100, y: 0 },
      colliders: [{ shape: circleShape(10) }],
    })
    const hit = world.raycast({ x: 0, y: 0 }, { x: 1, y: 0 }, 500)
    expect(hit).not.toBeNull()
    expect(hit!.distance).toBeCloseTo(90, 4)
    expect(hit!.point.x).toBeCloseTo(90, 4)
    expect(hit!.normal.x).toBeCloseTo(-1, 4)
    expect(hit!.normal.y).toBeCloseTo(0, 4)
  })

  it('misses when the ray points away', () => {
    const world = new PhysicsWorld()
    world.createBody({
      position: { x: 100, y: 0 },
      colliders: [{ shape: circleShape(10) }],
    })
    const hit = world.raycast({ x: 0, y: 0 }, { x: -1, y: 0 }, 500)
    expect(hit).toBeNull()
  })

  it('respects maxDistance', () => {
    const world = new PhysicsWorld()
    world.createBody({
      position: { x: 100, y: 0 },
      colliders: [{ shape: circleShape(10) }],
    })
    expect(world.raycast({ x: 0, y: 0 }, { x: 1, y: 0 }, 50)).toBeNull()
  })
})

describe('raycast vs AABB', () => {
  it('hits a box face with the correct normal', () => {
    const world = new PhysicsWorld()
    world.createBody({
      position: { x: 50, y: 0 },
      colliders: [{ shape: aabbShape(10, 10) }],
    })
    const hit = world.raycast({ x: 0, y: 0 }, { x: 1, y: 0 }, 500)
    expect(hit).not.toBeNull()
    expect(hit!.distance).toBeCloseTo(40, 4)
    expect(hit!.normal.x).toBeCloseTo(-1, 4)
  })
})

describe('raycast vs polygon', () => {
  it('hits a rotated triangle', () => {
    const world = new PhysicsWorld()
    world.createBody({
      position: { x: 50, y: 0 },
      colliders: [
        { shape: polygonShape([vec2(-10, -10), vec2(10, -10), vec2(0, 10)]) },
      ],
    })
    const hit = world.raycast({ x: 0, y: 0 }, { x: 1, y: 0 }, 500)
    expect(hit).not.toBeNull()
    expect(hit!.point.x).toBeGreaterThan(30)
    expect(hit!.point.x).toBeLessThan(50)
  })
})

describe('raycast nearest + mask', () => {
  it('returns the nearest of several bodies', () => {
    const world = new PhysicsWorld()
    const near = world.createBody({
      position: { x: 30, y: 0 },
      colliders: [{ shape: circleShape(5) }],
    })
    world.createBody({
      position: { x: 100, y: 0 },
      colliders: [{ shape: circleShape(5) }],
    })
    const hit = world.raycast({ x: 0, y: 0 }, { x: 1, y: 0 }, 500)
    expect(hit!.body).toBe(near)
  })

  it('skips bodies filtered out by mask', () => {
    const LAYER_A = 1 << 0
    const LAYER_B = 1 << 1
    const world = new PhysicsWorld()
    world.createBody({
      position: { x: 30, y: 0 },
      layer: LAYER_A,
      colliders: [{ shape: circleShape(5) }],
    })
    const far = world.createBody({
      position: { x: 100, y: 0 },
      layer: LAYER_B,
      colliders: [{ shape: circleShape(5) }],
    })
    const hit = world.raycast({ x: 0, y: 0 }, { x: 1, y: 0 }, 500, LAYER_B)
    expect(hit!.body).toBe(far)
  })
})

describe('queryRegion / queryPoint', () => {
  it('queryRegion returns bodies overlapping the region', () => {
    const world = new PhysicsWorld()
    const inside = world.createBody({
      position: { x: 0, y: 0 },
      colliders: [{ shape: circleShape(5) }],
    })
    world.createBody({
      position: { x: 1000, y: 0 },
      colliders: [{ shape: circleShape(5) }],
    })
    const out: (typeof inside)[] = []
    world.queryRegion(
      { x: -50, y: -50, width: 100, height: 100 },
      0xffffffff,
      out,
    )
    expect(out).toContain(inside)
    expect(out).toHaveLength(1)
  })

  it('queryPoint finds a circle containing the point', () => {
    const world = new PhysicsWorld()
    const b = world.createBody({
      position: { x: 0, y: 0 },
      colliders: [{ shape: circleShape(10) }],
    })
    const inside: (typeof b)[] = []
    world.queryPoint(3, 4, 0xffffffff, inside)
    expect(inside).toContain(b)
    const outside: (typeof b)[] = []
    world.queryPoint(20, 20, 0xffffffff, outside)
    expect(outside).toHaveLength(0)
  })
})
