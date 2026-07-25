/**
 * Binds a {@link Body} to a {@link SceneNode}'s transform. The engine steps the
 * body's world once per fixed tick; this behavior mirrors the body's position
 * and rotation onto the node each frame, interpolating between fixed steps so
 * rendering stays smooth at any display rate.
 */

import { Behavior } from '../scene/Behavior'
import type { SceneNode } from '../scene/SceneNode'
import { lerp, lerpAngle } from '../math/scalar'
import { Body, type BodyDef } from './Body'
import type { PhysicsWorld } from './PhysicsWorld'
import { PhysicsWorldBehavior } from './PhysicsWorldBehavior'

/**
 * Options for {@link RigidBodyBehavior}.
 *
 * @category Physics
 */
export interface RigidBodyBehaviorOptions {
  /**
   * World to register the body in. When omitted, resolution walks from the node
   * up through its ancestors for the nearest `PhysicsWorldBehavior` and uses
   * its world, then falls back to the stage world
   * (`node.scene.engine.physics`). Pass explicitly to override.
   */
  world?: PhysicsWorld
  /** Bind an existing body. */
  body?: Body
  /** Or create a body from this definition, seeded with the node's transform. */
  bodyDef?: BodyDef
  /** Interpolate the rendered transform between fixed steps. Default true. */
  interpolate?: boolean
  /** Mirror rotation onto the node. Default true. */
  syncRotation?: boolean
  /**
   * Extra per-frame gate on the transform sync, checked alongside
   * {@link RigidBodyBehavior.syncEnabled}. Return `false` to leave the node
   * transform untouched this frame (e.g. while a tween or a drag owns it).
   */
  shouldSync?: () => boolean
  /**
   * Whether this behavior owns the body's world membership. Default `true`: it
   * adds the body on scene-ready and removes it on detach. Set `false` (with an
   * explicit `body`) for the case where the game adds/removes bodies itself and
   * only wants the transform mirror — the behavior then skips world resolution
   * entirely and just syncs.
   */
  manageBody?: boolean
}

/**
 * Attach physics to a scene node.
 *
 * @category Physics
 * @example
 *   const node = new SceneNode('crate')
 *   node.transform.x = 100
 *   node.transform.y = 50
 *   node.addBehavior(
 *     new RigidBodyBehavior({
 *       bodyDef: {
 *         mass: 2,
 *         restitution: 0.3,
 *         colliders: [{ shape: aabbShape(16, 16) }],
 *       },
 *     }),
 *   )
 *   scene.root.add(node)
 */
export class RigidBodyBehavior extends Behavior {
  body!: Body
  /**
   * Interpolate the rendered transform between fixed steps. Mutable so a caller
   * can drop to hard-tracking (e.g. while a finger drags the body directly).
   */
  interpolate: boolean
  /**
   * When `false`, the behavior skips the per-frame transform sync entirely,
   * leaving the node transform for a tween or drag to own. Flip it back on to
   * resume mirroring the body. See also
   * {@link RigidBodyBehaviorOptions.shouldSync}.
   */
  syncEnabled = true
  #world: PhysicsWorld | null = null
  readonly #syncRotation: boolean
  readonly #shouldSync?: () => boolean
  readonly #manageBody: boolean
  readonly #explicitWorld?: PhysicsWorld
  readonly #explicitBody?: Body
  readonly #bodyDef?: BodyDef

  constructor(opts: RigidBodyBehaviorOptions = {}) {
    super()
    this.#explicitWorld = opts.world
    this.#explicitBody = opts.body
    this.#bodyDef = opts.bodyDef
    this.interpolate = opts.interpolate ?? true
    this.#syncRotation = opts.syncRotation ?? true
    this.#shouldSync = opts.shouldSync
    this.#manageBody = opts.manageBody ?? true
  }

  onSceneReady(): void {
    // Sync-only mode: the game owns the body's world membership, so bind the
    // given body and skip world resolution + registration.
    if (!this.#manageBody) {
      if (!this.#explicitBody) {
        throw new Error(
          'RigidBodyBehavior: manageBody:false requires an explicit `body`.',
        )
      }
      this.body = this.#explicitBody
      return
    }
    const world =
      this.#explicitWorld ??
      this.#nearestWorld() ??
      this.node.scene?.engine?.physics ??
      null
    if (!world) {
      throw new Error(
        'RigidBodyBehavior: no physics world. Add a PhysicsWorldBehavior to an ancestor, enable stage physics, or pass `world`.',
      )
    }
    this.#world = world
    if (this.#explicitBody) {
      this.body = this.#explicitBody
    } else {
      const t = this.node.transform
      const def: BodyDef = { ...this.#bodyDef }
      def.position ??= { x: t.x, y: t.y }
      def.rotation ??= t.rotation
      this.body = new Body(def)
    }
    world.addBody(this.body)
  }

  /**
   * The world of the nearest `PhysicsWorldBehavior` at or above this node, or
   * null if none. Starting at the node itself lets a body share a node with the
   * world that hosts it.
   */
  #nearestWorld(): PhysicsWorld | null {
    let node: SceneNode | null = this.node
    while (node) {
      const host = node.getBehavior(PhysicsWorldBehavior)
      if (host) return host.world
      node = node.parent
    }
    return null
  }

  onDetach(): void {
    this.#world?.removeBody(this.body)
    this.#world = null
  }

  onUpdate(): void {
    if (!this.syncEnabled) return
    if (this.#shouldSync && !this.#shouldSync()) return
    const t = this.node.transform
    const b = this.body
    const alpha =
      this.interpolate && this.node.scene?.engine
        ? this.node.scene.engine.ticker.fixedAlpha
        : 1
    t.x = lerp(b.prevPosition.x, b.position.x, alpha)
    t.y = lerp(b.prevPosition.y, b.position.y, alpha)
    if (this.#syncRotation) {
      t.rotation = lerpAngle(b.prevRotation, b.rotation, alpha)
    }
  }
}
