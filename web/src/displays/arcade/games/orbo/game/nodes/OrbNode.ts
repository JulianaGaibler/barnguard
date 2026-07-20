/**
 * Custom scene node for a single orb. Draws a flat-filled circle in the
 * player's color. The moment the orb enters its own scoring band a white
 * outline grows around it (nothing inside): its INNER edge is pinned to the orb
 * radius, and only the outer edge (the stroke width) animates — easing out past
 * the final width, then snapping back with a bit of bounce (`RING.overshoot`).
 * The ring shows/hides on band enter/leave immediately, not on settle. While
 * its lifetime is down to 1 the whole orb pulses its alpha as an "about to
 * expire" warning.
 *
 * The ring itself is DRAWN by a companion `RingNode` in a separate, lower layer
 * (so it's painted over by — never obstructs — a neighbouring orb's body); this
 * node owns the ring's animated width and lifecycle, the RingNode just reads +
 * renders it.
 *
 * The physics `body` is the source of truth for position — `onUpdate` mirrors
 * `body.x/y` into the transform each frame, so position tweens run on the body
 * and only scale is tweened on the node.
 */
import {
  SceneNode,
  ignoreAbort,
  easings,
  mixColor,
  hitTestCircle,
  lerp,
  type Gfx2D,
} from '@src/stargazer'
import type { FieldLayout } from '../layout'
import { isInOwnScoringBand, returnTeamForZone, zoneAtX } from '../layout'
import type { Orb } from '../Orb'
import type { TeamId } from '../types'
import { CAPTURE_GLOW, PULSE, RING } from '../tuning'
import { RingNode } from './RingNode'

const RING_POP = easings.makeOutBack(RING.overshoot)

export class OrbNode extends SceneNode {
  readonly body: Orb
  readonly #layout: FieldLayout
  readonly #color: string
  readonly #captureColorFor: (team: TeamId) => string
  #pulseClock = 0
  /**
   * Animated outline width (world units): 0 = hidden, overshoots past final
   * mid-pop.
   */
  readonly #ring = { width: 0 }
  #ringScoring = false
  #ringCtrl: AbortController | null = null
  /** Color this orb would become if taken now (resolved on capture-zone entry). */
  #captureColor: string | null = null
  /** Companion node that draws the ring in a higher layer (see class doc). */
  readonly #ringNode: RingNode

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
    ringLayer: SceneNode,
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
  }

  /** Current animated ring width (world units); read by the companion RingNode. */
  get ringWidth(): number {
    return this.#ring.width
  }

  override destroy(): void {
    if (!this.#ringNode.isDestroyed) this.#ringNode.destroy()
    super.destroy()
  }

  override onUpdate(dt: number): void {
    // Interpolate between the body's last two fixed-step positions by the
    // ticker's fixedAlpha so orbs render smoothly regardless of the display
    // rate vs the 120 Hz sim. A held orb tracks the finger directly (no lag).
    const alpha = this.body.isBeingDragged
      ? 1
      : (this.scene?.engine?.ticker.fixedAlpha ?? 1)
    const prev = this.body.prevPosition
    this.transform.x = lerp(prev.x, this.body.x, alpha)
    this.transform.y = lerp(prev.y, this.body.y, alpha)
    this.#pulseClock += dt

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
    // target color once on entry; `draw` blends toward it.
    const rt = returnTeamForZone(zoneAtX(this.#layout, this.body.x))
    const capturing =
      !this.body.markedForRemoval &&
      this.body.lifetimeRemaining > 1 &&
      rt !== null &&
      rt !== this.body.team
    if (capturing) {
      if (this.#captureColor === null)
        this.#captureColor = this.#captureColorFor(rt)
    } else {
      this.#captureColor = null
    }
  }

  #animateRing(show: boolean): void {
    this.#ringCtrl?.abort()
    const ctrl = new AbortController()
    this.#ringCtrl = ctrl
    if (show) {
      this.#ring.width = 0
      this.tweenTo(
        this.#ring,
        { width: RING.widthWorld },
        { duration: RING.popInSec, easing: RING_POP, signal: ctrl.signal },
      ).catch(ignoreAbort)
    } else {
      this.tweenTo(
        this.#ring,
        { width: 0 },
        {
          duration: RING.popOutSec,
          easing: easings.outCubic,
          signal: ctrl.signal,
        },
      ).catch(ignoreAbort)
    }
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

    if (this.body.lifetimeRemaining === 1) {
      const phase = (this.#pulseClock % PULSE.periodSec) / PULSE.periodSec
      const s = 0.5 + 0.5 * Math.sin(phase * Math.PI * 2)
      gfx.setAlpha(PULSE.minAlpha + (PULSE.maxAlpha - PULSE.minAlpha) * s)
    }

    // While in a capture zone, oscillate the fill between the orb's color and
    // the color it's about to become.
    let fill = this.#color
    if (this.#captureColor !== null) {
      const phase =
        (this.#pulseClock % CAPTURE_GLOW.periodSec) / CAPTURE_GLOW.periodSec
      const s = 0.5 + 0.5 * Math.sin(phase * Math.PI * 2)
      fill = mixColor(this.#color, this.#captureColor, s * CAPTURE_GLOW.maxMix)
    }

    gfx.fillCircle(0, 0, r, fill)
    // The white scoring ring is drawn by the companion `RingNode` in a lower
    // layer so it's painted over by any orb it touches instead of obstructing it.
  }
}
