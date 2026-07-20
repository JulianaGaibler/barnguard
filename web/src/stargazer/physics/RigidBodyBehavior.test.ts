import { describe, expect, it } from 'vitest'
import { SceneNode } from '../scene/SceneNode'
import { PhysicsWorld } from './PhysicsWorld'
import { PhysicsWorldBehavior } from './PhysicsWorldBehavior'
import { RigidBodyBehavior } from './RigidBodyBehavior'
import { circleShape } from './Collider'

// Drive the behavior lifecycle by hand (no full Engine): step the world, then
// mirror onFixedStep + onUpdate the way the engine loop would.
function attach(node: SceneNode, b: RigidBodyBehavior): void {
  ;(b as unknown as { node: SceneNode }).node = node
  b.onSceneReady()
}

describe('RigidBodyBehavior', () => {
  it('creates a body seeded from the node transform', () => {
    const world = new PhysicsWorld()
    const node = new SceneNode()
    node.transform.x = 30
    node.transform.y = -12
    node.transform.rotation = 0.25
    const b = new RigidBodyBehavior({
      world,
      bodyDef: { colliders: [{ shape: circleShape(5) }] },
    })
    attach(node, b)
    expect(b.body.position.x).toBe(30)
    expect(b.body.position.y).toBe(-12)
    expect(b.body.rotation).toBeCloseTo(0.25, 10)
    expect(world.bodyCount).toBe(1)
  })

  it('mirrors the stepped body position onto the node transform', () => {
    const world = new PhysicsWorld({ gravity: { x: 0, y: 100 } })
    const node = new SceneNode()
    const b = new RigidBodyBehavior({
      world,
      interpolate: false,
      bodyDef: { colliders: [{ shape: circleShape(5) }] },
    })
    attach(node, b)
    for (let i = 0; i < 10; i++) {
      world.step(1 / 120)
      b.onUpdate()
    }
    expect(b.body.position.y).toBeGreaterThan(0)
    // interpolate:false → transform tracks the current body position exactly.
    expect(node.transform.y).toBeCloseTo(b.body.position.y, 6)
  })

  it('binds to the nearest ancestor world when none is passed', () => {
    const arenaWorld = new PhysicsWorld()
    const arena = new SceneNode('arena')
    arena.addBehavior(new PhysicsWorldBehavior({ world: arenaWorld }))
    const child = new SceneNode()
    arena.add(child)

    const b = new RigidBodyBehavior({
      bodyDef: { colliders: [{ shape: circleShape(5) }] },
    })
    attach(child, b)
    expect(arenaWorld.bodyCount).toBe(1)
  })

  it('resolves a world hosted on the body node itself', () => {
    const arenaWorld = new PhysicsWorld()
    const arena = new SceneNode('arena')
    arena.addBehavior(new PhysicsWorldBehavior({ world: arenaWorld }))

    // Body and world share a node: resolution starts at the node itself.
    const b = new RigidBodyBehavior({
      bodyDef: { colliders: [{ shape: circleShape(5) }] },
    })
    attach(arena, b)
    expect(arenaWorld.bodyCount).toBe(1)
  })

  it('removes the body on detach', () => {
    const world = new PhysicsWorld()
    const node = new SceneNode()
    const b = new RigidBodyBehavior({
      world,
      bodyDef: { colliders: [{ shape: circleShape(5) }] },
    })
    attach(node, b)
    expect(world.bodyCount).toBe(1)
    b.onDetach()
    expect(world.bodyCount).toBe(0)
  })
})
