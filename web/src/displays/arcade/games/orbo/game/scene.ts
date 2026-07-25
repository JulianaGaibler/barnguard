/**
 * Shared field construction for Orbo, used by both the live session and the
 * tutorial demo so the physics feel, the bounding walls, and the field's clip
 * mask stay in sync when the game is tuned.
 */
import {
  Body,
  BodyType,
  aabbShape,
  buildBitmapMask,
  type BitmapMask,
  type PhysicsWorld,
  type PhysicsWorldConfig,
} from '@src/stargazer'
import { MAX_SPEED, PANEL, PHYSICS } from './tuning'
import type { FieldLayout } from './layout'

export interface Bounds {
  x: number
  y: number
  width: number
  height: number
}

/**
 * Physics config for the orbo world: no gravity, exponential damping, full-
 * separation positional correction, the rest threshold, and the anti-tunneling
 * speed cap. Returned fresh per call so callers can't cross-mutate.
 */
export function createOrboPhysicsConfig(): PhysicsWorldConfig {
  return {
    gravity: { x: 0, y: 0 },
    velocityIterations: PHYSICS.collisionIterations,
    positionIterations: PHYSICS.collisionIterations,
    correctionFactor: 1,
    positionalSlop: PHYSICS.positionalSlop,
    maxCorrection: PHYSICS.maxPositionalCorrection,
    sleepLinearThreshold: PHYSICS.minVelocity,
    sleepTime: 0.1,
    maxLinearSpeed: MAX_SPEED,
  }
}

/**
 * Four static walls just outside the field so orbs bounce off the edges
 * (restitution) and stay in bounds.
 */
export function buildOrboWalls(world: PhysicsWorld, layout: FieldLayout): void {
  const overhang = 200 // how far each wall extends past the field edge
  const w = layout.width
  const h = layout.height
  const addWall = (x: number, y: number, halfW: number, halfH: number): void => {
    world.addBody(
      new Body({
        type: BodyType.Static,
        position: { x, y },
        restitution: PHYSICS.restitution,
        friction: 0,
        colliders: [{ shape: aabbShape(halfW, halfH) }],
      }),
    )
  }
  addWall(-overhang, h / 2, overhang, h / 2 + overhang) // left
  addWall(w + overhang, h / 2, overhang, h / 2 + overhang) // right
  addWall(w / 2, -overhang, w / 2 + overhang, overhang) // top
  addWall(w / 2, h + overhang, w / 2 + overhang, overhang) // bottom
}

/**
 * Rounded-rect clip mask matching the field panel, in field WORLD coords. Used
 * to reveal the field with a horizontal clip that keeps the rounded corners and
 * to keep the tinted bands inside the rounded panel.
 */
export function createOrboFieldMask(bounds: Bounds): Promise<BitmapMask> {
  const path = new Path2D()
  path.roundRect(bounds.x, bounds.y, bounds.width, bounds.height, PANEL.radius)
  return buildBitmapMask({ path, worldRect: { ...bounds } })
}
