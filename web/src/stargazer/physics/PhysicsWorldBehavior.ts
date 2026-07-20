/**
 * Gives a subtree its own {@link PhysicsWorld}. Attach it to any node (usually a
 * `SceneNode` that roots the subtree) and that node becomes a simulation
 * boundary: `RigidBodyBehavior`s below it bind to this world instead of the
 * stage world, and the engine steps it each fixed tick. Drop the same subtree
 * in twice and you get two independent worlds.
 */

import { Behavior } from '../scene/Behavior'
import { PhysicsWorld, type PhysicsWorldConfig } from './PhysicsWorld'

/**
 * Options for {@link PhysicsWorldBehavior}.
 *
 * @category Physics
 */
export interface PhysicsWorldBehaviorOptions {
  /** Tuning for a world created by the behavior. Ignored when `world` is set. */
  config?: PhysicsWorldConfig
  /**
   * Adopt an existing world rather than creating one. The behavior registers
   * and unregisters it but does not clear it on detach (the owner does).
   */
  world?: PhysicsWorld
  /** Name shown in the debug HUD. Defaults to the node's id. */
  label?: string
}

/**
 * Attach an isolated physics world to a subtree.
 *
 * The node the behavior is attached to is the world's space node: its world
 * transform maps physics-space coordinates into scene coordinates, so the
 * subtree can sit anywhere in the tree and the debug overlay still draws the
 * world in the right place.
 *
 * The world exists as soon as the behavior is constructed, so you can add
 * bodies before the node is attached to a scene. Registration with the engine
 * (which starts the fixed-step stepping and makes the world visible to the
 * debugger) happens when the node enters a scene. Removing the behavior or
 * destroying the node unregisters the world; a world the behavior created is
 * also cleared then. Reparenting the node does not tear the world down, so a
 * subtree can move without losing its bodies. A node detached from the scene
 * without being destroyed keeps its world registered and stepping.
 *
 * @category Physics
 * @example
 *   const arena = new SceneNode('arena')
 *   const physics = arena.addBehavior(
 *     new PhysicsWorldBehavior({ config: { gravity: { x: 0, y: 0 } } }),
 *   )
 *   // Build directly against the world, or let child RigidBodyBehaviors
 *   // resolve to it automatically.
 *   physics.world.addBody(
 *     new Body({ colliders: [{ shape: aabbShape(20, 20) }] }),
 *   )
 *   scene.root.add(arena)
 */
export class PhysicsWorldBehavior extends Behavior {
  /** The world this behavior owns. Available from construction onward. */
  readonly world: PhysicsWorld
  readonly #owned: boolean
  readonly #label?: string
  #unregister: (() => void) | null = null

  constructor(opts: PhysicsWorldBehaviorOptions = {}) {
    super()
    if (opts.world) {
      this.world = opts.world
      this.#owned = false
    } else {
      this.world = new PhysicsWorld(opts.config)
      this.#owned = true
    }
    this.#label = opts.label
  }

  onSceneReady(): void {
    const engine = this.node.scene?.engine
    if (!engine) return
    this.#unregister = engine.registerPhysicsWorld(this.world, {
      spaceNode: this.node,
      label: this.#label ?? this.node.id,
    })
  }

  onDetach(): void {
    this.#unregister?.()
    this.#unregister = null
    if (this.#owned) this.world.clear()
  }
}
