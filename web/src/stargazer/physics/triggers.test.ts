import { describe, expect, it } from 'vitest'
import { PhysicsWorld } from './PhysicsWorld'
import { BodyType } from './types'
import { circleShape, aabbShape } from './Collider'

const DT = 1 / 120

describe('sensors / triggers', () => {
  it('fires triggerEnter then triggerExit as a body passes through a sensor', () => {
    const world = new PhysicsWorld()
    let enters = 0
    let exits = 0
    world.events.on('triggerEnter', () => enters++)
    world.events.on('triggerExit', () => exits++)
    // Static sensor zone at the origin.
    world.createBody({
      type: BodyType.Static,
      position: { x: 0, y: 0 },
      colliders: [{ shape: aabbShape(20, 20), sensor: true }],
    })
    // Body sliding through it left to right.
    const mover = world.createBody({
      position: { x: -100, y: 0 },
      velocity: { x: 200, y: 0 },
      linearDamping: 1,
      colliders: [{ shape: circleShape(5) }],
    })
    for (let i = 0; i < 120; i++) world.step(DT)
    expect(enters).toBe(1)
    expect(exits).toBe(1)
    // No physical deflection: it kept moving in a straight line.
    expect(mover.position.y).toBeCloseTo(0, 6)
    expect(mover.position.x).toBeGreaterThan(20)
  })

  it('reports the sensor and other collider on the event', () => {
    const world = new PhysicsWorld()
    let seenSensor = false
    let seenOther = false
    const zone = world.createBody({
      type: BodyType.Static,
      colliders: [{ shape: circleShape(30), sensor: true }],
    })
    const ball = world.createBody({
      position: { x: -100, y: 0 },
      velocity: { x: 200, y: 0 },
      colliders: [{ shape: circleShape(5) }],
    })
    world.events.on('triggerEnter', (e) => {
      seenSensor = e.sensorBody === zone
      seenOther = e.otherBody === ball
    })
    for (let i = 0; i < 120; i++) world.step(DT)
    expect(seenSensor).toBe(true)
    expect(seenOther).toBe(true)
  })

  it('a sensor collider does not resolve collisions', () => {
    const world = new PhysicsWorld()
    // A static solid wall and a static sensor at the same spot.
    world.createBody({
      type: BodyType.Static,
      position: { x: 0, y: 0 },
      colliders: [{ shape: circleShape(50), sensor: true }],
    })
    const ball = world.createBody({
      position: { x: 0, y: 0 },
      velocity: { x: 10, y: 0 },
      linearDamping: 1,
      colliders: [{ shape: circleShape(5) }],
    })
    for (let i = 0; i < 60; i++) world.step(DT)
    // Overlapping a sensor imparts no impulse: velocity is unchanged.
    expect(ball.velocity.x).toBeCloseTo(10, 6)
  })

  it('fires triggerExit when the sensor body is removed mid-overlap', () => {
    const world = new PhysicsWorld()
    let exits = 0
    world.events.on('triggerExit', () => exits++)
    const zone = world.createBody({
      type: BodyType.Static,
      colliders: [{ shape: circleShape(30), sensor: true }],
    })
    world.createBody({
      position: { x: 0, y: 0 },
      colliders: [{ shape: circleShape(5) }],
    })
    world.step(DT) // establish the overlap
    world.removeBody(zone)
    expect(exits).toBe(1)
  })
})
