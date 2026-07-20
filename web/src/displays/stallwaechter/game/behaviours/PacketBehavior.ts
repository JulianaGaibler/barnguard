import {
  Behavior,
  clampAbs,
  easings,
  ignoreAbort,
  type Rect,
  type Vec2,
} from '@src/stargazer'
import type { ParticleEmitterNode } from '@src/stargazer'
import type { PacketNode } from '../nodes/PacketNode'
import type { PathTrailNode } from '../nodes/PathTrailNode'
import type { EpicenterNode } from '../nodes/EpicenterNode'
import type { PacketMotionTrailNode } from '../nodes/PacketMotionTrailNode'
import { TUNING } from '../data/tuning'

export type PacketMode = 'growing' | 'travelling' | 'captured' | 'lost'

/**
 * Minimum surface `PacketBehavior` needs from a mask. Both the game's
 * `BitmapMask` (Germany outline) and the tutorial's `RectMask` (viewport AABB)
 * satisfy this, structural typing lets us swap them freely.
 */
export interface PacketMask {
  contains(x: number, y: number, inset: number): boolean
}

/**
 * The session-facing interface `PacketBehavior` needs. Only two hooks are
 * required, a state gate (so game-over silently freezes physics without
 * touching `engine.setPaused`) and outbound signals for game-side events.
 */
export interface PacketSessionHooks {
  /** True while the packet's physics should run this fixed step. */
  isPlaying(): boolean
  /** The safe zone this packet is aiming for. */
  epicenter(): EpicenterNode | null
  /**
   * The current game camera's viewport rect, used for edge turnaround so a
   * debug camera can't accidentally influence gameplay.
   */
  gameViewport(): Rect
  /**
   * Boundary of the play area. Germany outline in-game, viewport in the
   * tutorial.
   */
  mask(): PacketMask
  /**
   * Fired when this packet leaves Germany. Session emits `gameOver` from here.
   * `headingRad` is the packet's velocity direction at the moment of exit, used
   * to align the border-breach debris burst along the packet's outgoing
   * trajectory.
   */
  onExitedGermany(packet: PacketNode, worldPos: Vec2, headingRad: number): void
  /**
   * Fired when the packet reaches the epicenter capture radius (post-tween).
   * Session emits `packetScored` and destroys the packet.
   */
  onCaptured(packet: PacketNode): void
}

/**
 * Owns a packet's physics: growth on spawn, travel with variable speed,
 * steering along a drawn polyline (consuming the head as it advances),
 * viewport-edge turnaround while still inside Germany, mask-boundary exit
 * detection, and epicenter capture. See the plan for the full contract.
 */
export class PacketBehavior extends Behavior {
  readonly #session: PacketSessionHooks
  #mode: PacketMode = 'growing'
  readonly #velocity: Vec2 = { x: 0, y: 0 }
  #targetSpeed: number
  /** True once the growth animation completes and we can start integrating. */
  #travelReady = false
  #trail: PathTrailNode | null = null
  #motionTrail: PacketMotionTrailNode | null = null
  #hexParticles: ParticleEmitterNode | null = null
  /**
   * When false, the packet does not accelerate toward `travelSpeed` on its own,
   * it moves only when steered by a bound trail, and settles back to v=0
   * whenever the trail is absent or drained. Used by the tutorial mini-stage
   * where the packet should sit still until the player draws a path. Main game
   * always uses `true` (the default), so autonomous spawn drift stays
   * unchanged.
   */
  readonly #autonomousDrift: boolean
  /**
   * Reused tuple written each fixed step into the hex emitter's
   * `config.speedWorld`, pre-allocated so mutating the range doesn't churn the
   * GC at 120 Hz.
   */
  readonly #_hexSpeedRange: [number, number] = [0, 0]

  constructor(
    session: PacketSessionHooks,
    initialHeadingRad: number,
    travelSpeed: number,
    opts: { autonomousDrift?: boolean } = {},
  ) {
    super()
    this.#session = session
    this.#targetSpeed = travelSpeed
    this.#autonomousDrift = opts.autonomousDrift ?? true
    if (this.#autonomousDrift) {
      // Store initial heading with unit magnitude, approachTargetSpeed will
      // grow this to `travelSpeed` once the growth animation completes.
      this.#velocity.x = Math.cos(initialHeadingRad)
      this.#velocity.y = Math.sin(initialHeadingRad)
    }
    // else: velocity stays (0, 0) so the packet doesn't drift without a
    // trail. steerAlongTrail's `magnitude(v) || targetSpeed` fallback picks
    // targetSpeed when the first waypoint is consumed.
  }

  /** Called by the SpawnController after the grow tween settles. */
  markTravelReady(): void {
    this.#travelReady = true
    this.#mode = 'travelling'
    // The wake emitter was constructed with `ratePerSec: 0` so nothing
    // spawns at its default origin during the grow-in tween. Restore the
    // configured spawn rate now that we're moving.
    if (this.#hexParticles) {
      this.#hexParticles.emitter.config.ratePerSec =
        TUNING.packet.hexParticles.ratePerSec
    }
  }

  /**
   * Bind a shooting-star trail node, the session wires this on spawn. The
   * behavior feeds the trail world-space samples in `onFixedStep` and the
   * live-head position every render frame in `onUpdate` so the ribbon stays
   * glued to the hex even when the distance filter drops samples.
   */
  attachMotionTrail(trail: PacketMotionTrailNode): void {
    this.#motionTrail = trail
  }

  /**
   * Bind the wake-of-hexes particle emitter, session wires this on spawn. The
   * behavior drives `emitter.setOrigin` and `emitter.config.emitDirectionRad`
   * each fixed step so hexes always spawn at the packet's live position and
   * drift opposite the current velocity.
   */
  attachHexParticles(node: ParticleEmitterNode): void {
    this.#hexParticles = node
  }

  /**
   * Attach a `PathTrailNode`, packet steers along its points, consuming from
   * the head as it advances. Called by `PathDrawBehavior` when the player
   * finishes a drag.
   */
  setTrail(trail: PathTrailNode | null): void {
    this.#trail = trail
  }

  /** Currently-bound trail, read by `PathDrawBehavior` on resume. */
  get boundTrail(): PathTrailNode | null {
    return this.#trail
  }

  get currentMode(): PacketMode {
    return this.#mode
  }

  override onFixedStep(fdt: number): void {
    // Freeze physics for non-lost packets when the session isn't playing.
    // A 'lost' packet is the sole exception, it keeps drifting past the
    // border after game-over so the escape reads as a slow silent exit.
    if (this.#mode === 'captured') return
    if (!this.#session.isPlaying() && this.#mode !== 'lost') return
    if (!this.#travelReady) return

    const packet = this.node as PacketNode
    const t = packet.transform

    // 1) Steer along the trail if one is bound + still has points ahead.
    if (this.#trail && this.#mode === 'travelling') {
      this.#steerAlongTrail(packet, fdt)
    }

    // 2) Ensure velocity magnitude is at the target speed. Simple lerp toward
    //    target magnitude, accelToSpeedSec controls the approach.
    //    Non-autonomous packets (tutorial) start at v=0, and approachTargetSpeed
    //    early-returns while `magnitude < 1e-4`, so they only begin drifting
    //    once `steerAlongTrail` sets a nonzero velocity from the first drawn
    //    trail point. From that moment on, the packet is fully autonomous.
    approachTargetSpeed(this.#velocity, this.#targetSpeed, fdt)

    // 3) Integrate position.
    t.x += this.#velocity.x * fdt
    t.y += this.#velocity.y * fdt

    // 3.5) Orient the hex to face the direction of travel. The hex's local
    //      "top" vertex sits at angle -π/2 (i.e., pointing at +y = down in
    //      standard maths but "up" in canvas coords), so a +π/2 offset lines
    //      it up with the velocity heading. Skipped in 'growing' / 'captured'
    //      via the top-of-fn guards.
    t.rotation = Math.atan2(this.#velocity.y, this.#velocity.x) + Math.PI / 2

    // 3.6) Feed the motion trail a distance-filtered sample of the packet's
    //      new position. The filter dedupes near-stationary frames; the
    //      ribbon draw injects a live-head vertex from `onUpdate` so it
    //      stays glued to the hex regardless of the filter's threshold.
    this.#motionTrail?.sample(t.x, t.y)

    // 3.7) Aim the wake-of-hexes emitter to inherit the packet's velocity
    //      vector on emit, same direction, same speed magnitude, so a
    //      newly-spawned hex "peels off" the packet moving with it, then
    //      the emitter's `dampingPerSec` decelerates it into the trail.
    if (this.#hexParticles) {
      const emitter = this.#hexParticles.emitter
      emitter.setOrigin(t.x, t.y)
      const speed = Math.sqrt(
        this.#velocity.x * this.#velocity.x +
          this.#velocity.y * this.#velocity.y,
      )
      emitter.config.emitDirectionRad = Math.atan2(
        this.#velocity.y,
        this.#velocity.x,
      )
      // Small ±10% variance keeps the wake from looking mechanical, each
      // hex spawns at a slightly different speed then dampens at the same
      // rate, so they naturally spread along the trail.
      this.#_hexSpeedRange[0] = speed * 0.9
      this.#_hexSpeedRange[1] = speed * 1.1
      emitter.config.speedWorld = this.#_hexSpeedRange
    }

    // 4) Border turnaround, only while playing (a 'lost' packet is meant to
    //    drift out silently, not bounce off).
    if (this.#mode === 'travelling') {
      this.#applyBorderTurnaround(t.x, t.y, fdt)
    }

    // 5) Mask boundary check.
    if (
      this.#mode === 'travelling' &&
      !this.#session.mask().contains(t.x, t.y, 0)
    ) {
      this.#mode = 'lost'
      this.#session.onExitedGermany(
        packet,
        { x: t.x, y: t.y },
        Math.atan2(this.#velocity.y, this.#velocity.x),
      )
      return
    }

    // 6) Epicenter capture. Compound gate: the player must have routed this
    //    packet (a trail is bound) AND the packet must sit within
    //    `captureRadius` of the apex AND be travelling INTO the cone, i.e.
    //    its heading lies within `±(coneSweep/2 + approachForgiveness)` of
    //    the inward axis. The drawn line no longer has to terminate exactly
    //    at the apex, entering the safe zone at the correct angle
    //    auto-captures. Free-floating packets that never got a trail do NOT
    //    capture, the player still has to actively route them in.
    if (this.#mode === 'travelling' && this.#trail) {
      const ep = this.#session.epicenter()
      if (ep) {
        const c = ep.center
        const dx = c.x - t.x
        const dy = c.y - t.y
        if (
          dx * dx + dy * dy <= ep.captureRadius * ep.captureRadius &&
          ep.isEntryHeadingValid(Math.atan2(this.#velocity.y, this.#velocity.x))
        ) {
          this.#startCapture(packet, c)
        }
      }
    }
  }

  /**
   * Steer along the trail. `markConsumed` advances the queue, faded points stay
   * in the polyline for `PathTrailNode` to drop lazily. Reference survives
   * finger pauses and pointerup, packet keeps its last vector when the queue
   * drains and re-aims when fresh points arrive.
   */
  #steerAlongTrail(packet: PacketNode, fdt: number): void {
    if (!this.#trail) return
    const trail = this.#trail
    const engine = packet.scene?.engine
    const nowSec = engine ? engine.ticker.time : 0
    const px = packet.transform.x
    const py = packet.transform.y
    const consume = TUNING.packet.consumeRadius
    const consumeSq = consume * consume
    const scratch = this.#_trailScratch

    // 1) Consume any waypoints already within the consume radius.
    while (trail.nextTargetIndex < trail.pointCount) {
      trail.pointAt(trail.nextTargetIndex, scratch)
      const cdx = scratch.x - px
      const cdy = scratch.y - py
      if (cdx * cdx + cdy * cdy <= consumeSq) {
        trail.markConsumed(nowSec)
        continue
      }
      break
    }
    if (trail.nextTargetIndex >= trail.pointCount) {
      // Queue drained, keep the reference bound; the packet keeps its
      // current vector until fresh points arrive (from an active drag) or
      // the finger releases and re-taps.
      return
    }

    // 2) Pure-pursuit carrot. Walk `lookaheadDist` through the upcoming
    //    waypoints. Preserves curvature, aiming at raw waypoints one at a
    //    time flattens the tail into straight legs. Past the last waypoint
    //    we extrapolate along the final tangent for smooth aim.
    const lookaheadDist = TUNING.path.minPointDistWorld * 2
    let idx = trail.nextTargetIndex
    trail.pointAt(idx, scratch)
    let ax = px
    let ay = py
    let bx = scratch.x
    let by = scratch.y
    let remaining = lookaheadDist
    let targetX = bx
    let targetY = by
    while (true) {
      const segDx = bx - ax
      const segDy = by - ay
      const segLen = Math.sqrt(segDx * segDx + segDy * segDy)
      if (segLen >= remaining) {
        const t = segLen > 1e-6 ? remaining / segLen : 0
        targetX = ax + segDx * t
        targetY = ay + segDy * t
        break
      }
      remaining -= segLen
      if (idx + 1 >= trail.pointCount) {
        // Beyond the polyline; extrapolate along the current segment.
        if (segLen > 1e-3) {
          targetX = bx + (segDx / segLen) * remaining
          targetY = by + (segDy / segLen) * remaining
        } else {
          targetX = bx
          targetY = by
        }
        break
      }
      ax = bx
      ay = by
      idx++
      trail.pointAt(idx, scratch)
      bx = scratch.x
      by = scratch.y
    }

    // 3) Angular-velocity-limited steering, a hard `velocity = normalize(dx,
    //    dy) * speed` would let the packet snap to any heading instantly,
    //    which converts sharp finger reversals into hard V-turns. Instead
    //    we rotate the current heading toward the carrot at
    //    `TUNING.packet.turnRateRadPerSec`, so sharp inputs turn into
    //    tight loops rather than snap-reversals.
    const targetHeading = Math.atan2(targetY - py, targetX - px)
    const currentHeading = Math.atan2(this.#velocity.y, this.#velocity.x)
    const diff = wrapAngle(targetHeading - currentHeading)
    const step = TUNING.packet.turnRateRadPerSec * fdt
    const applied = clampAbs(diff, step)
    const newHeading = currentHeading + applied
    const speed = magnitude(this.#velocity) || this.#targetSpeed
    this.#velocity.x = Math.cos(newHeading) * speed
    this.#velocity.y = Math.sin(newHeading) * speed
  }

  /** Scratch buffer for `pointAt(out)`, no per-tick allocations. */
  readonly #_trailScratch: { x: number; y: number } = { x: 0, y: 0 }

  #applyBorderTurnaround(x: number, y: number, fdt: number): void {
    const vp = this.#session.gameViewport()
    const buf = TUNING.borderTurnaround.edgeBufferWorld
    const overLeft = x - vp.x < buf
    const overRight = vp.x + vp.width - x < buf
    const overTop = y - vp.y < buf
    const overBottom = vp.y + vp.height - y < buf
    if (!overLeft && !overRight && !overTop && !overBottom) return
    // Only steer if still inside Germany, otherwise let the exit fire.
    if (!this.#session.mask().contains(x, y, 8)) return

    // Compute a "toward interior" heading: aim at the viewport centre.
    const cx = vp.x + vp.width / 2
    const cy = vp.y + vp.height / 2
    const dx = cx - x
    const dy = cy - y
    const dist = Math.sqrt(dx * dx + dy * dy)
    if (dist < 1e-3) return
    const targetHeading = Math.atan2(dy / dist, dx / dist)
    const currentHeading = Math.atan2(this.#velocity.y, this.#velocity.x)
    const diff = wrapAngle(targetHeading - currentHeading)
    const step = TUNING.borderTurnaround.angularVelRadPerSec * fdt
    const applied = clampAbs(diff, step)
    const newHeading = currentHeading + applied
    const speed = magnitude(this.#velocity) || this.#targetSpeed
    this.#velocity.x = Math.cos(newHeading) * speed
    this.#velocity.y = Math.sin(newHeading) * speed
  }

  override onUpdate(_dt: number): void {
    // Keep the motion trail's live head + the wake emitter's origin pinned
    // to the packet's current visible position each render frame. Skipped
    // during grow / capture so neither visual awkwardly tracks those
    // animations.
    if (this.#mode !== 'travelling' && this.#mode !== 'lost') return
    const t = this.node.transform
    this.#motionTrail?.setLiveHead(t.x, t.y)
    this.#hexParticles?.emitter.setOrigin(t.x, t.y)
  }

  #startCapture(packet: PacketNode, center: Vec2): void {
    this.#mode = 'captured'
    // Disable collision the moment we start homing in.
    packet.hitEnabled = false
    // Clear the shooting-star ribbon so it doesn't flap around during the
    // capture tween. The trail node itself is destroyed by the packet's
    // scene-graph destroy handler once the tween resolves. Do the same
    // for the wake emitter, otherwise it would keep spawning hexes at
    // the (now animating) capture center for the tween's duration.
    this.#motionTrail?.clear()
    this.#hexParticles?.emitter.clear()
    if (this.#hexParticles) {
      this.#hexParticles.emitter.config.ratePerSec = 0
    }
    // Tween to the exact centre; on completion emit + destroy.
    packet
      .tween(
        { x: center.x, y: center.y, scaleX: 0.4, scaleY: 0.4, alpha: 0 },
        { duration: 0.35, easing: easings.inOutQuad },
      )
      .then(() => {
        if (packet.isDestroyed) return
        this.#session.onCaptured(packet)
      })
      .catch(ignoreAbort)
  }
}

// -----------------------------------------------------------------------------
// Small vector helpers, no allocations, no exports.
// -----------------------------------------------------------------------------

function magnitude(v: Vec2): number {
  return Math.sqrt(v.x * v.x + v.y * v.y)
}

function approachTargetSpeed(v: Vec2, target: number, fdt: number): void {
  const mag = magnitude(v)
  if (mag < 1e-4) {
    // Zero vector, nothing to accelerate. Callers should have set a
    // direction before entering onFixedStep.
    return
  }
  // First-order low-pass toward target speed.
  const rate = 1 / Math.max(TUNING.packet.accelToSpeedSec, 1e-3)
  const alpha = 1 - Math.exp(-rate * fdt)
  const nextMag = mag + (target - mag) * alpha
  const scale = nextMag / mag
  v.x *= scale
  v.y *= scale
}

function wrapAngle(a: number): number {
  while (a > Math.PI) a -= Math.PI * 2
  while (a < -Math.PI) a += Math.PI * 2
  return a
}
