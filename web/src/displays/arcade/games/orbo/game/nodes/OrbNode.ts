/**
 * Custom scene node for a single orb. Draws a flat-filled circle in the
 * player's color. The moment the orb enters its own scoring band a white
 * outline grows around it (nothing inside): its INNER edge is pinned to the orb
 * radius, and only the outer edge (the stroke width) animates — easing out past
 * the final width, then snapping back with a bit of bounce (`RING.overshoot`).
 * The ring shows/hides on band enter/leave immediately, not on settle. While
 * its lifetime is down to 1, the fill oscillates between the orb's color and
 * black — an "about to expire" warning using the same treatment as the capture
 * glow below, just toward black instead of the capturing team's color.
 *
 * The ring itself is DRAWN by a companion `RingNode` in a separate, lower layer
 * (so it's painted over by — never obstructs — a neighbouring orb's body); this
 * node owns the ring's animated width and lifecycle, the RingNode just reads +
 * renders it.
 *
 * The physics `body` is the source of truth for position — a sync-only
 * {@link RigidBodyBehavior} mirrors `body.x/y` into the transform each frame
 * (the session owns the body's world membership, so `manageBody: false`), so
 * position tweens run on the body and only scale is tweened on the node. This
 * node toggles the behavior's `interpolate` (off while a finger drags, to track
 * with no lag) and `syncEnabled` (off during a slide-off tween).
 */
import {
  Node2D,
  RigidBodyBehavior,
  easings,
  mixColor,
  hitTestCircle,
  type Gfx2D,
} from '@src/stargazer'
import type { FieldLayout } from '../layout'
import { isInOwnScoringBand, returnTeamForZone, zoneAtX } from '../layout'
import type { Orb } from '../Orb'
import type { TeamId } from '../types'
import { CAPTURE_GLOW, LOW_LIFE_GLOW, RING } from '../tuning'
import { RingNode } from './RingNode'

const RING_POP = easings.makeOutBack(RING.overshoot)

export class OrbNode extends Node2D {
  readonly body: Orb
  readonly #layout: FieldLayout
  readonly #color: string
  readonly #captureColorFor: (team: TeamId) => string
  #pulseClock = 0
  /** While sliding off screen, position is tweened directly, not mirrored. */
  #slidingOff = false
  /**
   * Animated outline width (world units): 0 = hidden, overshoots past final
   * mid-pop.
   */
  readonly #ring = { width: 0 }
  #ringScoring = false
  /** Color this orb would become if taken now (resolved on capture-zone entry). */
  #captureColor: string | null = null
  /** Companion node that draws the ring in a higher layer (see class doc). */
  readonly #ringNode: RingNode
  /** Sync-only physics mirror; this node toggles its interpolate/syncEnabled. */
  readonly #rb: RigidBodyBehavior

  constructor(
    body: Orb,
    layout: FieldLayout,
    color: string,
    /**
     * Resolves the color the orb becomes if captured by `team`, evaluated on
     * entry.
     */
    captureColorFor: (team: TeamId) => string,
    /** Layer (below the orbs) the companion ring node is attached to. */
    ringLayer: Node2D,
  ) {
    super(`orb-${body.id}`)
    this.body = body
    this.#layout = layout
    this.#color = color
    this.#captureColorFor = captureColorFor
    this.renderLayer = 'dynamic'
    this.transform.x = body.x
    this.transform.y = body.y
    const r = body.radius
    this.debugBounds = { x: -r, y: -r, width: 2 * r, height: 2 * r }

    this.#ringNode = new RingNode(this)
    ringLayer.add(this.#ringNode)

    // The body already lives in the session-owned world (manageBody:false); this
    // behavior only mirrors it onto the transform, interpolating between fixed
    // steps. `onUpdate` (which runs before behaviors) sets the flags below.
    this.#rb = new RigidBodyBehavior({
      body,
      manageBody: false,
      syncRotation: false,
      shouldSync: () => !this.#slidingOff,
    })
    this.addBehavior(this.#rb)
  }

  /** Current animated ring width (world units); read by the companion RingNode. */
  get ringWidth(): number {
    return this.#ring.width
  }

  override destroy(): void {
    this.#ringNode.destroy()
    super.destroy()
  }

  override onUpdate(dt: number): void {
    this.#pulseClock += dt
    // Drive the sync-only physics mirror (its onUpdate runs right after this):
    // a held orb tracks the finger directly (no interpolation lag), and a
    // slide-off tween owns the transform outright (sync off, via `shouldSync`).
    this.#rb.interpolate = !this.body.isBeingDragged

    // Show as soon as the orb is inside its own scoring band — no wait for it
    // to settle. Toggles on band enter/leave.
    const scoring =
      !this.body.markedForRemoval && isInOwnScoringBand(this.#layout, this.body)

    if (scoring !== this.#ringScoring) {
      this.#ringScoring = scoring
      this.#animateRing(scoring)
    }

    // Capture glow: resting in the OTHER team's launch strip with the lifetime
    // left to survive being taken means it's about to change hands. Resolve the
    // target color once on entry; `draw` blends toward it. Excluding the last
    // life here also keeps this mutually exclusive with the low-life glow: an
    // orb on its last life explodes on return instead of being captured, so it
    // should never flash the other team's color.
    const returnTeam = returnTeamForZone(zoneAtX(this.#layout, this.body.x))
    const capturing =
      !this.body.markedForRemoval &&
      this.body.lifetimeRemaining > 1 &&
      returnTeam !== null &&
      returnTeam !== this.body.team
    if (capturing) {
      if (this.#captureColor === null)
        this.#captureColor = this.#captureColorFor(returnTeam)
    } else {
      this.#captureColor = null
    }
  }

  #animateRing(show: boolean): void {
    // Keyed so each show/hide cleanly replaces the in-flight ring tween — no
    // hand-held AbortController. Fire-and-forget: the width is cosmetic.
    if (show) this.#ring.width = 0
    this.playTo(
      this.#ring,
      { width: show ? RING.widthWorld : 0 },
      {
        duration: show ? RING.popInSec : RING.popOutSec,
        easing: show ? RING_POP : easings.outCubic,
        key: 'ring',
      },
    )
  }

  /**
   * Slide the orb off whichever screen edge it's nearest (left or right,
   * decided by its side of the center line), then resolve. Sets `#slidingOff`
   * so the physics mirror (via `shouldSync`) yields the transform to this
   * tween. Rejects with `AbortError` if `signal` fires, so the caller's
   * sequence unwinds.
   */
  slideOff(durationSec: number, signal?: AbortSignal): Promise<void> {
    this.#slidingOff = true
    const goLeft = this.body.x < this.#layout.centerX
    const offX = goLeft
      ? -this.body.radius * 2
      : this.#layout.width + this.body.radius * 2
    return this.tween(
      { x: offX },
      { duration: durationSec, easing: easings.inCubic, signal },
    )
  }

  override hitTest(
    worldX: number,
    worldY: number,
    touchSlopWorld: number,
  ): boolean {
    return hitTestCircle(this, worldX, worldY, this.body.radius, touchSlopWorld)
  }

  override draw(gfx: Gfx2D): void {
    const r = this.body.radius

    // While in a capture zone, oscillate the fill between the orb's color and
    // the color it's about to become. Otherwise, on its last life, oscillate
    // toward black as an "about to expire" warning. `capturing` already
    // excludes the last life (see `onUpdate`), so these never overlap.
    let fill = this.#color
    if (this.#captureColor !== null) {
      const phase =
        (this.#pulseClock % CAPTURE_GLOW.periodSec) / CAPTURE_GLOW.periodSec
      const mix = 0.5 + 0.5 * Math.sin(phase * Math.PI * 2)
      fill = mixColor(
        this.#color,
        this.#captureColor,
        mix * CAPTURE_GLOW.maxMix,
      )
    } else if (this.body.lifetimeRemaining === 1) {
      const phase =
        (this.#pulseClock % LOW_LIFE_GLOW.periodSec) / LOW_LIFE_GLOW.periodSec
      // Rest on the orb's color, then dip to black and back over the final
      // `blackFraction` of the period. A raised-cosine over that window keeps
      // the excursion smooth at both ends (zero slope where it meets the rest).
      const rest = 1 - LOW_LIFE_GLOW.blackFraction
      const mix =
        phase < rest
          ? 0
          : 0.5 -
            0.5 *
              Math.cos(
                ((phase - rest) / LOW_LIFE_GLOW.blackFraction) * Math.PI * 2,
              )
      fill = mixColor(
        this.#color,
        LOW_LIFE_GLOW.color,
        mix * LOW_LIFE_GLOW.maxMix,
      )
    }

    gfx.fillCircle(0, 0, r, fill)
    // The white scoring ring is drawn by the companion `RingNode` in a lower
    // layer so it's painted over by any orb it touches instead of obstructing it.
  }
}
