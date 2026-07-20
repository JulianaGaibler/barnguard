import { describe, expect, it } from 'vitest'
import { PhysicsWorld } from './PhysicsWorld'
import { BodyType } from './types'
import { circleShape, aabbShape } from './Collider'

const DT = 1 / 120

describe('integration', () => {
  it('a dynamic body accelerates under gravity', () => {
    const world = new PhysicsWorld({ gravity: { x: 0, y: 10 } })
    const b = world.createBody({ colliders: [{ shape: circleShape(1) }] })
    world.step(DT)
    // v = g*dt, y advanced by v*dt.
    expect(b.velocity.y).toBeCloseTo(10 * DT, 6)
    expect(b.position.y).toBeGreaterThan(0)
  })

  it('linearDamping bleeds off speed frame-rate-independently', () => {
    const world = new PhysicsWorld()
    const b = world.createBody({
      velocity: { x: 100, y: 0 },
      linearDamping: 0.5,
      colliders: [{ shape: circleShape(1) }],
    })
    world.step(DT)
    // Damping factor 0.5^(dt*60).
    expect(b.velocity.x).toBeCloseTo(100 * Math.pow(0.5, DT * 60), 6)
  })

  it('static bodies never move', () => {
    const world = new PhysicsWorld({ gravity: { x: 0, y: 10 } })
    const b = world.createBody({
      type: BodyType.Static,
      colliders: [{ shape: aabbShape(5, 5) }],
    })
    world.step(DT)
    expect(b.position.x).toBe(0)
    expect(b.position.y).toBe(0)
  })
})

describe('circle-circle collision', () => {
  it('equal-mass head-on with restitution 1 swaps velocities', () => {
    const world = new PhysicsWorld()
    const a = world.createBody({
      position: { x: -0.4, y: 0 },
      velocity: { x: 2, y: 0 },
      restitution: 1,
      colliders: [{ shape: circleShape(0.5) }],
    })
    const b = world.createBody({
      position: { x: 0.4, y: 0 },
      velocity: { x: 0, y: 0 },
      restitution: 1,
      colliders: [{ shape: circleShape(0.5) }],
    })
    world.step(DT)
    expect(a.velocity.x).toBeCloseTo(0, 4)
    expect(b.velocity.x).toBeCloseTo(2, 4)
  })

  it('restitution 0 leaves the pair moving together (no bounce)', () => {
    const world = new PhysicsWorld()
    const a = world.createBody({
      position: { x: -0.4, y: 0 },
      velocity: { x: 2, y: 0 },
      restitution: 0,
      colliders: [{ shape: circleShape(0.5) }],
    })
    const b = world.createBody({
      position: { x: 0.4, y: 0 },
      restitution: 0,
      colliders: [{ shape: circleShape(0.5) }],
    })
    world.step(DT)
    // Momentum shared: both end near the average velocity (1).
    expect(a.velocity.x).toBeCloseTo(1, 3)
    expect(b.velocity.x).toBeCloseTo(1, 3)
  })

  it('separates overlapping bodies over time via positional correction', () => {
    const world = new PhysicsWorld({ correctionFactor: 1 })
    const a = world.createBody({
      position: { x: -0.1, y: 0 },
      colliders: [{ shape: circleShape(0.5) }],
    })
    const b = world.createBody({
      position: { x: 0.1, y: 0 },
      colliders: [{ shape: circleShape(0.5) }],
    })
    for (let i = 0; i < 20; i++) world.step(DT)
    const dist = Math.abs(b.position.x - a.position.x)
    expect(dist).toBeGreaterThanOrEqual(1 - 0.02)
  })
})

describe('resting on a static floor', () => {
  it('a falling circle settles just above the floor', () => {
    const world = new PhysicsWorld({ gravity: { x: 0, y: 500 } })
    world.createBody({
      type: BodyType.Static,
      position: { x: 0, y: 100 },
      colliders: [{ shape: aabbShape(200, 10) }],
    })
    const ball = world.createBody({
      position: { x: 0, y: 0 },
      restitution: 0,
      colliders: [{ shape: circleShape(10) }],
    })
    for (let i = 0; i < 600; i++) world.step(DT)
    // Floor top is at y=90; ball radius 10 → center rests near y=80.
    expect(ball.position.y).toBeGreaterThan(75)
    expect(ball.position.y).toBeLessThan(85)
  })
})

describe('sleep and settle', () => {
  it('a slow body sleeps after sleepTime and the world reports rest', () => {
    const world = new PhysicsWorld({ sleepTime: 0.1 })
    const b = world.createBody({
      velocity: { x: 0.001, y: 0 },
      colliders: [{ shape: circleShape(1) }],
    })
    for (let i = 0; i < 30; i++) world.step(DT)
    expect(b.sleeping).toBe(true)
    expect(world.isAtRest()).toBe(true)
  })

  it('waitForSettle resolves once the world comes to rest', async () => {
    const world = new PhysicsWorld({ gravity: { x: 0, y: 500 } })
    world.createBody({
      type: BodyType.Static,
      position: { x: 0, y: 100 },
      colliders: [{ shape: aabbShape(200, 10) }],
    })
    world.createBody({
      position: { x: 0, y: 0 },
      colliders: [{ shape: circleShape(10) }],
    })
    let settled = false
    const p = world.waitForSettle().then(() => {
      settled = true
    })
    for (let i = 0; i < 600 && !settled; i++) world.step(DT)
    await p
    expect(settled).toBe(true)
  })

  it('forceSettle zeroes velocities and resolves waiters', async () => {
    const world = new PhysicsWorld()
    world.createBody({
      velocity: { x: 100, y: 0 },
      linearDamping: 1,
      colliders: [{ shape: circleShape(1) }],
    })
    let settled = false
    const p = world.waitForSettle().then(() => {
      settled = true
    })
    world.forceSettle()
    await p
    expect(settled).toBe(true)
  })
})

describe('collision events', () => {
  it('emits collisionEnter once when two bodies begin touching', () => {
    const world = new PhysicsWorld()
    let enters = 0
    world.events.on('collisionEnter', () => enters++)
    const a = world.createBody({
      position: { x: -5, y: 0 },
      velocity: { x: 100, y: 0 },
      colliders: [{ shape: circleShape(0.5) }],
    })
    world.createBody({
      position: { x: 0, y: 0 },
      colliders: [{ shape: circleShape(0.5) }],
    })
    for (let i = 0; i < 20; i++) world.step(DT)
    expect(enters).toBe(1)
    expect(a.position.x).toBeGreaterThan(-5)
  })

  it('emits collisionExit when bodies separate', () => {
    const world = new PhysicsWorld()
    let exits = 0
    world.events.on('collisionExit', () => exits++)
    const a = world.createBody({
      position: { x: -0.4, y: 0 },
      velocity: { x: 5, y: 0 },
      restitution: 1,
      colliders: [{ shape: circleShape(0.5) }],
    })
    world.createBody({
      position: { x: 0.4, y: 0 },
      velocity: { x: -5, y: 0 },
      restitution: 1,
      colliders: [{ shape: circleShape(0.5) }],
    })
    for (let i = 0; i < 40; i++) world.step(DT)
    void a
    expect(exits).toBeGreaterThanOrEqual(1)
  })
})

describe('determinism', () => {
  it('two identical worlds produce identical positions', () => {
    function run(): number[] {
      const world = new PhysicsWorld({ gravity: { x: 0, y: 300 } })
      world.createBody({
        type: BodyType.Static,
        position: { x: 0, y: 200 },
        colliders: [{ shape: aabbShape(300, 10) }],
      })
      const bodies = []
      for (let i = 0; i < 5; i++) {
        bodies.push(
          world.createBody({
            position: { x: i * 5 - 10, y: -i * 30 },
            restitution: 0.4,
            colliders: [{ shape: circleShape(8) }],
          }),
        )
      }
      for (let i = 0; i < 300; i++) world.step(DT)
      return bodies.flatMap((b) => [b.position.x, b.position.y])
    }
    const a = run()
    const b = run()
    expect(a).toEqual(b)
  })
})

describe('interpolation snapshot', () => {
  it('records prevPosition/prevRotation from before the step', () => {
    const world = new PhysicsWorld()
    const b = world.createBody({
      position: { x: 0, y: 0 },
      velocity: { x: 60, y: 0 },
      colliders: [{ shape: circleShape(1) }],
    })
    world.step(DT)
    // prev holds the pre-step position, position the post-step one.
    expect(b.prevPosition.x).toBeCloseTo(0, 6)
    expect(b.position.x).toBeCloseTo(60 * DT, 6)
    // Interpolating by alpha reproduces the swept path.
    const half = b.prevPosition.x + (b.position.x - b.prevPosition.x) * 0.5
    expect(half).toBeCloseTo((60 * DT) / 2, 6)
  })
})

describe('contact accessors', () => {
  it('exposes the last step’s solid contacts', () => {
    const world = new PhysicsWorld()
    world.createBody({
      position: { x: -0.4, y: 0 },
      colliders: [{ shape: circleShape(0.5) }],
    })
    world.createBody({
      position: { x: 0.4, y: 0 },
      colliders: [{ shape: circleShape(0.5) }],
    })
    world.step(DT)
    expect(world.contactCount).toBeGreaterThanOrEqual(1)
    const m = world.getContact(0)
    expect(Math.hypot(m.normal.x, m.normal.y)).toBeCloseTo(1, 6)
    expect(m.contactCount).toBeGreaterThanOrEqual(1)
  })

  it('reports zero contacts when nothing overlaps', () => {
    const world = new PhysicsWorld()
    world.createBody({
      position: { x: -100, y: 0 },
      colliders: [{ shape: circleShape(1) }],
    })
    world.createBody({
      position: { x: 100, y: 0 },
      colliders: [{ shape: circleShape(1) }],
    })
    world.step(DT)
    expect(world.contactCount).toBe(0)
  })
})

describe('resolveOverlaps', () => {
  it('pushes a body clear of an overlapping neighbor', () => {
    const world = new PhysicsWorld()
    world.createBody({
      position: { x: 0, y: 0 },
      colliders: [{ shape: circleShape(1) }],
    })
    const b = world.createBody({
      position: { x: 0.2, y: 0 },
      colliders: [{ shape: circleShape(1) }],
    })
    const ok = world.resolveOverlaps(b)
    expect(ok).toBe(true)
    const dist = Math.hypot(b.position.x, b.position.y)
    expect(dist).toBeGreaterThanOrEqual(2 - 1e-2)
  })
})

describe('clampSpeed', () => {
  it('clamps a launch velocity to maxLinearSpeed', () => {
    const world = new PhysicsWorld({ maxLinearSpeed: 10 })
    const { vx, vy } = world.clampSpeed(30, 40)
    expect(Math.hypot(vx, vy)).toBeCloseTo(10, 6)
  })
  it('leaves a slow velocity untouched', () => {
    const world = new PhysicsWorld({ maxLinearSpeed: 10 })
    const { vx, vy } = world.clampSpeed(3, 4)
    expect(vx).toBe(3)
    expect(vy).toBe(4)
  })
})
