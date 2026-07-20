/**
 * 2D rigid-body physics. A {@link PhysicsWorld} steps {@link Body} instances
 * (each carrying one or more {@link Collider}s) under a fixed timestep,
 * resolving contacts and firing trigger events. Attach a body to a scene node
 * with {@link RigidBodyBehavior}, or drive the world directly. Broad-phase is
 * pluggable ({@link BruteForceBroadPhase}, {@link SpatialHashBroadPhase}). See
 * the physics guide for the full model.
 *
 * @module physics
 * @category Physics
 */
export { PhysicsWorld } from '../physics/PhysicsWorld'
export type {
  PhysicsWorldConfig,
  ResolvedPhysicsConfig,
} from '../physics/PhysicsWorld'
export { Body, BodyType } from '../physics/Body'
export type { BodyDef } from '../physics/Body'
export {
  Collider,
  circleShape,
  aabbShape,
  polygonShape,
} from '../physics/Collider'
export type {
  ColliderDef,
  Shape,
  CircleShape,
  AABBShape,
  PolygonShape,
} from '../physics/Collider'
export { LAYER_DEFAULT, LAYER_ALL, shouldCollide } from '../physics/layers'
export { BruteForceBroadPhase } from '../physics/BroadPhase'
export type { BroadPhase, PairCallback } from '../physics/BroadPhase'
export { SpatialHashBroadPhase } from '../physics/SpatialHashBroadPhase'
export { RigidBodyBehavior } from '../physics/RigidBodyBehavior'
export type { RigidBodyBehaviorOptions } from '../physics/RigidBodyBehavior'
export { PhysicsWorldBehavior } from '../physics/PhysicsWorldBehavior'
export type { PhysicsWorldBehaviorOptions } from '../physics/PhysicsWorldBehavior'
export type {
  Material,
  Contact,
  Manifold,
  RaycastHit,
  KinematicHit,
  PhysicsEvents,
} from '../physics/types'
