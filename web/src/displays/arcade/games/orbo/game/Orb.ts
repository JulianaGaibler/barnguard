/**
 * One orb on the field: a stargazer {@link Body} plus the game fields orbo needs
 * (team, size, lifetime, home anchor). The flat `x`/`y`/`vx`/`vy` accessors
 * proxy the body's `position`/`velocity` so the game and node code read the
 * body as their source of truth, exactly as before the physics moved into the
 * engine.
 *
 * Ghost mode (`isBeingDragged`) clears the collision mask so a held orb passes
 * over resting orbs; releasing it restores the mask. Orbs never spin, so they
 * are `fixedRotation` with no contact friction — the arcade feel is pure
 * restitution plus exponential damping.
 */
import { Body, BodyType, LAYER_ALL, circleShape } from '@src/stargazer'
import type { OrbSize, TeamId } from './types'

export interface OrbParams {
  x: number
  y: number
  radius: number
  mass: number
  size: OrbSize
  player: number
  team: TeamId
  lifetimeRemaining: number
  /** Bounciness in `[0, 1]`. */
  restitution: number
  /** Per-frame velocity retention, applied as `base^(dt*60)`. */
  linearDamping: number
  /** Linear speed below which the orb sleeps. */
  sleepThreshold: number
}

export class Orb extends Body {
  readonly radius: number
  size: OrbSize
  player: number
  team: TeamId
  lifetimeRemaining: number
  /** Spawn/return anchor, used by the flick snap-back tween. */
  homeX: number
  homeY: number
  /** Excluded from collisions + tally while its removal animation plays. */
  markedForRemoval = false
  #_dragging = false

  constructor(params: OrbParams) {
    super({
      type: BodyType.Dynamic,
      position: { x: params.x, y: params.y },
      mass: params.mass,
      restitution: params.restitution,
      friction: 0,
      linearDamping: params.linearDamping,
      fixedRotation: true,
      sleepThreshold: params.sleepThreshold,
      colliders: [{ shape: circleShape(params.radius) }],
    })
    this.radius = params.radius
    this.size = params.size
    this.player = params.player
    this.team = params.team
    this.lifetimeRemaining = params.lifetimeRemaining
    this.homeX = params.x
    this.homeY = params.y
  }

  get x(): number {
    return this.position.x
  }
  set x(v: number) {
    this.position.x = v
  }
  get y(): number {
    return this.position.y
  }
  set y(v: number) {
    this.position.y = v
  }
  get vx(): number {
    return this.velocity.x
  }
  set vx(v: number) {
    this.velocity.x = v
  }
  get vy(): number {
    return this.velocity.y
  }
  set vy(v: number) {
    this.velocity.y = v
  }

  /** True sleep flag, mirroring the body's sleep state. */
  get isSleeping(): boolean {
    return this.sleeping
  }
  set isSleeping(v: boolean) {
    if (v) this.sleeping = true
    else this.wake()
  }

  /**
   * Ghost mode while a finger holds the orb: it collides with nothing (passes
   * over resting orbs) and is not disturbed by them. Releasing restores the
   * mask.
   */
  get isBeingDragged(): boolean {
    return this.#_dragging
  }
  set isBeingDragged(v: boolean) {
    if (this.#_dragging === v) return
    this.#_dragging = v
    this.mask = v ? 0 : LAYER_ALL
    if (v) this.wake()
  }
}
