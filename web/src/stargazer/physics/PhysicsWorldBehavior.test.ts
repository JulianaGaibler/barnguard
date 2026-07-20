import { describe, expect, it } from 'vitest'
import { Scene } from '../scene/Scene'
import { SceneNode } from '../scene/SceneNode'
import type { Engine, RegisteredPhysicsWorld } from '../engine/Engine'
import { Body } from './Body'
import { circleShape } from './Collider'
import { PhysicsWorld } from './PhysicsWorld'
import { PhysicsWorldBehavior } from './PhysicsWorldBehavior'

// A stand-in engine that records physics-world registrations, so the behavior
// can be exercised without constructing a full Stage/Renderer.
function fakeEngine(): {
  engine: Engine
  registered: RegisteredPhysicsWorld[]
  unregistered: RegisteredPhysicsWorld[]
} {
  const registered: RegisteredPhysicsWorld[] = []
  const unregistered: RegisteredPhysicsWorld[] = []
  const engine = {
    registerPhysicsWorld(
      world: RegisteredPhysicsWorld['world'],
      opts: {
        spaceNode?: SceneNode | null
        label?: string
      },
    ) {
      const entry: RegisteredPhysicsWorld = {
        world,
        spaceNode: opts.spaceNode ?? null,
        label: opts.label ?? 'world',
      }
      registered.push(entry)
      return () => unregistered.push(entry)
    },
  } as unknown as Engine
  return { engine, registered, unregistered }
}

describe('PhysicsWorldBehavior', () => {
  it('registers its world with the engine on scene attach', () => {
    const { engine, registered } = fakeEngine()
    const scene = new Scene()
    scene.engine = engine
    const arena = new SceneNode('arena')
    scene.root.add(arena)
    const physics = arena.addBehavior(new PhysicsWorldBehavior())

    expect(registered).toHaveLength(1)
    expect(registered[0].world).toBe(physics.world)
    expect(registered[0].spaceNode).toBe(arena)
    expect(registered[0].label).toBe('arena')
  })

  it('unregisters and clears an owned world on detach', () => {
    const { engine, unregistered } = fakeEngine()
    const scene = new Scene()
    scene.engine = engine
    const arena = new SceneNode('arena')
    scene.root.add(arena)
    const physics = arena.addBehavior(new PhysicsWorldBehavior())
    physics.world.addBody(new Body({ colliders: [{ shape: circleShape(5) }] }))
    expect(physics.world.bodyCount).toBe(1)

    arena.removeBehavior(physics)
    expect(unregistered).toHaveLength(1)
    expect(physics.world.bodyCount).toBe(0)
  })

  it('does not clear an adopted world on detach', () => {
    const { engine } = fakeEngine()
    const scene = new Scene()
    scene.engine = engine
    const world = new PhysicsWorld()
    world.addBody(new Body({ colliders: [{ shape: circleShape(5) }] }))
    const arena = new SceneNode('arena')
    scene.root.add(arena)
    const physics = arena.addBehavior(new PhysicsWorldBehavior({ world }))

    arena.removeBehavior(physics)
    // The behavior did not create this world, so its contents survive.
    expect(world.bodyCount).toBe(1)
  })
})
