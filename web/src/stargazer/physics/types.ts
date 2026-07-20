/**
 * Shared physics types with no runtime dependencies, kept in one place so the
 * body / collider / solver / world modules can reference them without import
 * cycles.
 */

import type { Vec2 } from '../math/Vec2'
import type { Body } from './Body'
import type { Collider } from './Collider'

/**
 * How a body participates in the simulation.
 *
 * @category Physics
 */
export const BodyType = {
  /** Never moves; infinite mass. Walls and static geometry. */
  Static: 0,
  /** Fully simulated: integrated, collided, and resolved. */
  Dynamic: 1,
  /**
   * Moved only by game code (position/velocity setters, `moveAndSlide`). Pushes
   * dynamic bodies but is never pushed by them.
   */
  Kinematic: 2,
} as const

export type BodyType = (typeof BodyType)[keyof typeof BodyType]

/**
 * Bounce and friction for a collider. Any field left undefined falls back to
 * the owning body's value.
 *
 * @category Physics
 */
export interface Material {
  /** Bounciness in `[0, 1]`: 0 is a dead stop, 1 conserves normal speed. */
  restitution?: number
  /** Coulomb friction coefficient; 0 is frictionless. */
  friction?: number
}

/**
 * One contact point in a {@link Manifold}: a world-space position and the
 * penetration depth measured along the manifold normal.
 *
 * @category Physics
 */
export interface Contact {
  point: Vec2
  penetration: number
}

/**
 * The result of a narrow-phase test between two colliders that overlap. The
 * normal points from `a` toward `b`. Manifolds are pooled and reused across
 * steps, so do not retain one past the step that produced it.
 *
 * @category Physics
 */
export interface Manifold {
  a: Body
  b: Body
  colliderA: Collider
  colliderB: Collider
  /** Unit normal, pointing from `a` toward `b`. */
  normal: Vec2
  /** Deepest penetration across the contact points. */
  penetration: number
  contactCount: 0 | 1 | 2
  points: [Contact, Contact]
  /**
   * True when either collider is a sensor, so the pair reports but never
   * resolves.
   */
  isSensor: boolean
}

/**
 * A ray/query hit against a collider.
 *
 * @category Physics
 */
export interface RaycastHit {
  body: Body
  collider: Collider
  /** World-space hit position. */
  point: Vec2
  /** Surface normal at the hit, pointing back toward the ray origin. */
  normal: Vec2
  /** Distance from the ray origin along the ray direction. */
  distance: number
}

/**
 * The result of a kinematic move that was blocked by a contact.
 *
 * @category Physics
 */
export interface KinematicHit {
  body: Body
  collider: Collider
  normal: Vec2
  /** Motion actually applied before the contact. */
  travel: Vec2
  /** Motion left over after the contact (used by slide). */
  remainder: Vec2
}

/**
 * Events emitted by a physics world. Payloads are pooled, so read what you need
 * inside the handler rather than retaining the object.
 *
 * @category Physics
 */
export interface PhysicsEvents {
  /** Two solid colliders started touching this step. */
  collisionEnter: { a: Body; b: Body; manifold: Readonly<Manifold> }
  /** Two solid colliders stopped touching. */
  collisionExit: { a: Body; b: Body }
  /** A sensor overlap began. */
  triggerEnter: {
    sensor: Collider
    other: Collider
    sensorBody: Body
    otherBody: Body
  }
  /** A sensor overlap ended. */
  triggerExit: {
    sensor: Collider
    other: Collider
    sensorBody: Body
    otherBody: Body
  }
  /** A dynamic body went to sleep. */
  sleep: { body: Body }
  /** A sleeping body woke up. */
  wake: { body: Body }
}
