/**
 * A rigid body: transform state, velocity, mass properties, and the colliders
 * that give it shape. Create bodies through {@link PhysicsWorld.createBody}.
 */

import { vec2, type Vec2 } from '../math/Vec2'
import { rect, rectUnion, type Rect } from '../math/Rect'
import { LAYER_ALL, LAYER_DEFAULT } from './layers'
import { Collider, shapeArea, shapeInertia, type ColliderDef } from './Collider'
import { BodyType } from './types'
import type { PhysicsWorld } from './PhysicsWorld'

export { BodyType }

/**
 * Construction parameters for a {@link Body}. Every field is optional. The
 * defaults make a unit-mass dynamic body at the origin with no colliders.
 */
export interface BodyDef {
  /** Static, dynamic, or kinematic. Default {@link BodyType.Dynamic}. */
  type?: BodyType
  /** World position. Default the origin. */
  position?: Readonly<Vec2>
  /** Rotation in radians. */
  rotation?: number
  /** Initial velocity in world units per second. */
  velocity?: Readonly<Vec2>
  /** Angular velocity in radians per second. */
  angularVelocity?: number
  /** Mass, treated as infinite for static and kinematic bodies. */
  mass?: number
  /**
   * Exponential linear retention per frame, applied as `base^(dt*60)`. Default
   * 1 (none).
   */
  linearDamping?: number
  /** Exponential angular retention per frame. Default 1 (none). */
  angularDamping?: number
  /** Bounciness in `[0, 1]`. Default 0. */
  restitution?: number
  /** Coulomb friction coefficient. Default 0. */
  friction?: number
  /** Linear speed below which the body may sleep. Defaults to the world config. */
  sleepThreshold?: number
  /** Whether the body may ever sleep. Default true. */
  canSleep?: boolean
  /** Lock rotation (infinite rotational inertia). Default false. */
  fixedRotation?: boolean
  /** Layers this body occupies. Default {@link LAYER_DEFAULT}. */
  layer?: number
  /** Layers this body collides with. Default {@link LAYER_ALL}. */
  mask?: number
  /** Shapes to attach. Mass properties are derived from them. */
  colliders?: ColliderDef[]
  /** Per-body fat-AABB margin override (world units). */
  aabbMargin?: number
  /** Free slot for the game's own reference. The engine never reads it. */
  userData?: unknown
}

let nextBodyId = 1

/** A rigid body in a {@link PhysicsWorld}. */
export class Body {
  /** Stable unique id for debugging and user bookkeeping. */
  readonly id: number
  /** Static, dynamic, or kinematic. See {@link BodyType}. */
  type: BodyType
  /** World position. Mutate through {@link setPosition} to wake and re-index. */
  readonly position: Vec2
  /**
   * Position at the start of the last {@link PhysicsWorld.step}. Interpolate
   * between this and {@link position} by `ticker.fixedAlpha` when rendering, so
   * motion stays smooth at display rates that differ from the fixed step.
   */
  readonly prevPosition: Vec2
  /** Rotation in radians. */
  rotation: number
  /** Rotation at the start of the last step (for render interpolation). */
  prevRotation: number
  /** World units per second. Mutate in place, the solver reads it every step. */
  readonly velocity: Vec2
  /** Radians per second. */
  angularVelocity: number

  /**
   * Mass in world units. Ignored for static and kinematic bodies, which the
   * solver treats as infinitely heavy.
   */
  mass: number
  /**
   * `1 / mass`, or `0` for a body the solver must not push (anything not
   * dynamic, or with a non-positive mass). Multiplying by this is what lets the
   * solver skip a body-type branch, so a stale value here silently breaks
   * contacts. {@link Body.computeMassProperties} keeps it in sync.
   */
  invMass: number
  /** Inverse rotational inertia. `0` under {@link Body.fixedRotation}. */
  invInertia: number
  /** Bounciness in `[0, 1]`. A pair's effective value is the larger of the two. */
  restitution: number
  /**
   * Coulomb friction coefficient. A pair's effective value is the geometric
   * mean.
   */
  friction: number
  /** Velocity retained per frame, as `base^(dt*60)`. `1` is no damping. */
  linearDamping: number
  /** Angular velocity retained per frame. `1` is no damping. */
  angularDamping: number
  /**
   * Bitmask of the layers this body occupies. A pair collides only when each
   * side's `layer` is in the other's {@link Body.mask}, so a one-sided mask
   * still blocks the pair.
   */
  layer: number
  /** Bitmask of the layers this body collides with. See {@link Body.layer}. */
  mask: number
  /** Lock rotation by treating rotational inertia as infinite. */
  fixedRotation: boolean
  /** Whether the body may ever sleep. */
  canSleep: boolean
  /** Linear speed below which the body starts counting toward sleep. */
  sleepThreshold: number
  /**
   * Whether the body is asleep. A sleeping body is skipped by integration and
   * the solver until a contact or an explicit {@link Body.wake} revives it.
   */
  sleeping = false
  /** Free slot for the game to hang its own reference off a body. */
  userData: unknown
  /** How far the broad-phase AABB is inflated, to absorb small motion. */
  aabbMargin: number

  /**
   * Attached shapes. Add and remove through {@link Body.addCollider} and
   * {@link Body.removeCollider}, which re-derive the mass properties.
   */
  readonly colliders: Collider[] = []

  // Force accumulators, consumed and cleared each step.
  _forceX = 0
  _forceY = 0
  _torque = 0
  /** Seconds spent below the sleep threshold. */
  _sleepTimer = 0
  /** Dense world slot, assigned on add and used for pair keys and broad-phase. */
  _index = -1
  /** Owning world, set on add. */
  _world: PhysicsWorld | null = null
  /** Set when position/rotation changes, so the broad-phase re-indexes. */
  _aabbDirty = true

  constructor(def: BodyDef = {}) {
    this.id = nextBodyId++
    this.type = def.type ?? BodyType.Dynamic
    this.position = vec2(def.position?.x ?? 0, def.position?.y ?? 0)
    this.prevPosition = vec2(this.position.x, this.position.y)
    this.rotation = def.rotation ?? 0
    this.prevRotation = this.rotation
    this.velocity = vec2(def.velocity?.x ?? 0, def.velocity?.y ?? 0)
    this.angularVelocity = def.angularVelocity ?? 0
    this.mass = def.mass ?? 1
    this.restitution = def.restitution ?? 0
    this.friction = def.friction ?? 0
    this.linearDamping = def.linearDamping ?? 1
    this.angularDamping = def.angularDamping ?? 1
    this.layer = def.layer ?? LAYER_DEFAULT
    this.mask = def.mask ?? LAYER_ALL
    this.fixedRotation = def.fixedRotation ?? false
    this.canSleep = def.canSleep ?? true
    this.sleepThreshold = def.sleepThreshold ?? 0
    this.aabbMargin = def.aabbMargin ?? 0
    this.userData = def.userData
    this.invMass = 0
    this.invInertia = 0
    if (def.colliders) {
      for (const c of def.colliders) this.addCollider(c)
    }
    this.computeMassProperties()
  }

  /**
   * Recompute inverse mass and inertia from the current mass, type, and
   * colliders. Called automatically when colliders change. Call it manually
   * after mutating `mass` or `fixedRotation`.
   */
  computeMassProperties(): void {
    if (this.type !== BodyType.Dynamic || this.mass <= 0) {
      this.invMass = 0
      this.invInertia = 0
      return
    }
    this.invMass = 1 / this.mass
    if (this.fixedRotation || this.colliders.length === 0) {
      this.invInertia = 0
      return
    }
    let totalArea = 0
    for (const c of this.colliders) totalArea += shapeArea(c.shape)
    if (totalArea <= 0) {
      this.invInertia = 0
      return
    }
    let inertia = 0
    for (const c of this.colliders) {
      const frac = shapeArea(c.shape) / totalArea
      const m = frac * this.mass
      const offSq = c.offset.x * c.offset.x + c.offset.y * c.offset.y
      // Parallel-axis theorem about the body origin.
      inertia += shapeInertia(c.shape, m) + m * offSq
    }
    this.invInertia = inertia > 0 ? 1 / inertia : 0
  }

  /** Add a collider from a definition and return it. */
  addCollider(def: ColliderDef): Collider {
    const c = new Collider(def)
    c.body = this
    this.colliders.push(c)
    this.computeMassProperties()
    return c
  }

  /** Remove a collider previously added. */
  removeCollider(c: Collider): void {
    const i = this.colliders.indexOf(c)
    if (i >= 0) {
      this.colliders.splice(i, 1)
      this.computeMassProperties()
    }
  }

  /** Apply a force at the center of mass (accumulated until the next step). */
  applyForce(fx: number, fy: number): void {
    this._forceX += fx
    this._forceY += fy
    this.wake()
  }

  /** Apply a force at a world point, adding the resulting torque. */
  applyForceAtPoint(fx: number, fy: number, px: number, py: number): void {
    this._forceX += fx
    this._forceY += fy
    const rx = px - this.position.x
    const ry = py - this.position.y
    this._torque += rx * fy - ry * fx
    this.wake()
  }

  /** Apply an instantaneous change in velocity (`Δv = impulse * invMass`). */
  applyImpulse(ix: number, iy: number): void {
    this.velocity.x += ix * this.invMass
    this.velocity.y += iy * this.invMass
    this.wake()
  }

  /** Apply an impulse at a world point, adding the resulting angular impulse. */
  applyImpulseAtPoint(ix: number, iy: number, px: number, py: number): void {
    this.velocity.x += ix * this.invMass
    this.velocity.y += iy * this.invMass
    const rx = px - this.position.x
    const ry = py - this.position.y
    this.angularVelocity += (rx * iy - ry * ix) * this.invInertia
    this.wake()
  }

  /** Apply a torque (accumulated until the next step). */
  applyTorque(t: number): void {
    this._torque += t
    this.wake()
  }

  /** Set the linear velocity and wake the body. */
  setVelocity(vx: number, vy: number): void {
    this.velocity.x = vx
    this.velocity.y = vy
    this.wake()
  }

  /** Set the world position, wake the body, and mark it for re-indexing. */
  setPosition(x: number, y: number): void {
    this.position.x = x
    this.position.y = y
    this._aabbDirty = true
    this.wake()
  }

  /** Set the rotation (radians), wake the body, and mark it for re-indexing. */
  setRotation(radians: number): void {
    this.rotation = radians
    this._aabbDirty = true
    this.wake()
  }

  /** Wake the body if it was sleeping. */
  wake(): void {
    this._sleepTimer = 0
    if (this.sleeping) {
      this.sleeping = false
      this._world?._onWake(this)
    }
  }

  /** Force the body to sleep: zero its velocity and stop simulating it. */
  sleep(): void {
    this.velocity.x = 0
    this.velocity.y = 0
    this.angularVelocity = 0
    if (!this.sleeping) {
      this.sleeping = true
      this._world?._onSleep(this)
    }
  }

  /** World-space AABB over all colliders, into `out`. */
  computeAABB(out: Rect): Rect {
    if (this.colliders.length === 0) {
      out.x = this.position.x
      out.y = this.position.y
      out.width = 0
      out.height = 0
      return out
    }
    this.colliders[0].computeWorldAABB(out)
    for (let i = 1; i < this.colliders.length; i++) {
      this.colliders[i].computeWorldAABB(SCRATCH_AABB)
      rectUnion(out, out, SCRATCH_AABB)
    }
    return out
  }
}

const SCRATCH_AABB = rect()
