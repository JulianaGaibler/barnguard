/**
 * World-unit tuning for orbo. Ported from the reference `_constants.ts` and
 * rescaled from its screen-pixel space to this repo's fixed 1920×1080 world
 * (stargazer's default 16:9 viewport). Dead reference constants
 * (`MAX_DRAG_FORCE`, `DRAG_FORCE_MULTIPLIER`, `MIN_THROW_FORCE`,
 * `PIECE_EXIT_DURATION`, per-piece `color`, `MERRIWEATHER`) are intentionally
 * dropped.
 *
 * Everything flagged "feel knob" is expected to be nudged during playtest.
 */
import type { OrbSize } from './types'

/**
 * Field band fractions (of width, horizontal layout). Reference used the same
 * numbers vertically: strips 0.15, scoring bands 0.35.
 */
export const THROW_ZONE_FRACTION = 0.15
export const TARGET_ZONE_FRACTION = 0.35

/**
 * Per-size orb geometry. Radii rescaled ~1.75× from the reference (15/25/35) to
 * read well on the big field: 26/44/62. **Mass is hardcoded 1/2/4** and is
 * deliberately NOT derived from area — doubling a radius would quadruple an
 * area-derived mass and wreck the arcade feel.
 */
export const ORB_SIZES: Record<
  OrbSize,
  { radius: number; mass: number; lifetime: number }
> = {
  SMALL: { radius: 26, mass: 1, lifetime: 3 },
  MEDIUM: { radius: 44, mass: 2, lifetime: 3 },
  LARGE: { radius: 62, mass: 4, lifetime: 3 },
}

/** Per-player starting queue composition (shuffled into a queue per player). */
export const STARTING_ORBS: Record<OrbSize, number> = {
  SMALL: 3,
  MEDIUM: 2,
  LARGE: 1,
}

/**
 * Player colors, authoritative from the reference `_Game.svelte` CSS vars
 * (which override the constants file). Index = player id. Team 0 = {P0, P2},
 * Team 1 = {P1, P3}.
 */
export const PLAYER_COLORS = [
  '#4A90E2', // P0 — Team L (blue)
  '#E24A4A', // P1 — Team R (red)
  '#4AE24A', // P2 — Team L (green)
  '#FFDA0D', // P3 — Team R (yellow)
] as const

/** Base color per team (used for the tinted scoring bands). */
export const TEAM_COLORS = [PLAYER_COLORS[0], PLAYER_COLORS[1]] as const

/** Physics feel. See the ported reference for the impulse/friction model. */
export const PHYSICS = {
  /** Per-frame velocity retention, applied as `friction^(dt*60)`. */
  friction: 0.98,
  /**
   * Rest threshold (world u/s). Reference used 0.1 in pixel space; in world
   * space that never settles in reasonable time, so this is retuned up — a feel
   * knob balancing "snappy turns" against "orbs stop dead too early".
   */
  minVelocity: 6,
  /**
   * Restitution. `1.0` is the exact equal-mass velocity-swap case; 0.9 feels
   * good.
   */
  restitution: 0.9,
  /** Collision resolution passes per step (reference used 3). */
  collisionIterations: 3,
  /**
   * Positional-overlap slop: overlaps smaller than this are left alone so
   * resting stacks don't jitter. Corrections only push out the excess.
   */
  positionalSlop: 0.5,
  /**
   * Per-iteration positional correction cap (~largest radius) — anti-explosion
   * backstop.
   */
  maxPositionalCorrection: ORB_SIZES.LARGE.radius,
} as const

/**
 * Tunneling clamp: cap speed so a hard flick can't skip past the smallest orb
 * in one fixed step. `smallestRadius / fixedDt` at 120 Hz.
 */
export const FIXED_DT = 1 / 120
export const MAX_SPEED = ORB_SIZES.SMALL.radius / FIXED_DT

/** Flick interaction. */
export const FLICK = {
  /** Release drag-speed → launch-speed multiplier (reference 0.5). */
  velocityToForce: 0.5,
  /**
   * Minimum windowed drag speed (world u/s) to count as a throw — feel knob
   * (~2× reference 500).
   */
  minThrowVelocity: 900,
  /** Velocity is computed over this trailing window; digitizers are noisy. */
  sampleWindowMs: 70,
} as const

/** Animation durations (seconds). */
export const ANIM = {
  /** Active orb slides in from the player's side edge into the flick strip. */
  spawnSlideIn: 0.45,
  snapBack: 0.25,
  removeShrink: 0.3,
  /** Game-over: shrink out orbs that don't contribute to the score. */
  gameOverShrink: 0.25,
  /** Game-over "counting": each scoring orb bounces big → back. */
  countBounceUp: 0.16,
  countBounceDown: 0.22,
  countBounceScale: 1.5,
  /**
   * Delay between the START of each counted orb's bounce — a staggered cascade,
   * not one-waits-for-the-last. Only the final orb's bounce is fully awaited.
   */
  countStagger: 0.05,
  /** Pause after the count finishes, before the losing side explodes. */
  postCountPause: 1.0,
  /** How long the round-end result holds before folding back to the menu. */
  explodeHold: 2.0,
  /** Field reveal: a horizontal clip opening from the center on match start. */
  revealOpen: 0.55,
  /** Field "fold closed" to the center when returning to the main screen. */
  foldClose: 0.4,
} as const

/**
 * Pause gesture: a horizontal swipe that STARTS near the field's vertical
 * center line (not on an orb) and drags outward opens the pause menu. Fractions
 * are of the field width.
 */
export const PAUSE_GESTURE = {
  /** Half-width of the central "start zone" band around `centerX`. */
  startBandFrac: 0.18,
  /** Outward horizontal travel that commits the pause. */
  triggerFrac: 0.14,
} as const

/** Max seconds to wait for the field to settle before force-settling the turn. */
export const SETTLE_TIMEOUT_SEC = 9

/**
 * White scoring-ring look + its grow/bounce entrance. The ring's INNER edge is
 * pinned to the orb radius; only its outer edge (the stroke width) animates —
 * it eases out past the final width, then snaps back to it.
 */
export const RING = {
  /** Settled outline thickness, growing outward from the orb edge (world units). */
  widthWorld: 8,
  color: '#ffffff',
  /** Grow-in duration: eases out past the final width, then snaps back to it. */
  popInSec: 0.42,
  /** Shrink-out duration when the orb leaves its scoring band. */
  popOutSec: 0.16,
  /** Overshoot strength of the pop-in (higher = more "heft"). */
  overshoot: 2.6,
} as const

/** Low-lifetime pulse (alpha oscillation while `lifetimeRemaining === 1`). */
export const PULSE = {
  periodSec: 1.2,
  minAlpha: 0.55,
  maxAlpha: 1,
} as const

/**
 * Capture glow: while an orb rests in the OTHER team's launch strip (and has
 * the lifetime left to survive being taken), its fill oscillates between its
 * current color and the color it is about to become — a cue that it's about to
 * change hands. `maxMix` = 1 reaches the target color fully at the peak of the
 * cycle.
 */
export const CAPTURE_GLOW = {
  periodSec: 2.4,
  maxMix: 1,
} as const

/** Bottom queue-indicator strips (drawn in-engine as scene nodes). */
export const INDICATOR = {
  /** Dot radius as a fraction of the real orb radius (small dots). */
  sizeScale: 0.12,
  /** Gap between dots (world units). */
  gapWorld: 8,
  /** Distance of the strip center from the top/bottom edge (world units). */
  edgeMargin: 60,
  /** Enter/leave fade travel: dots slide in/out horizontally (world units). */
  driftWorld: 46,
  /** Animation durations (seconds). */
  addSec: 0.28,
  removeSec: 0.24,
  shiftSec: 0.3,
} as const

/**
 * Live "orbs currently in the scoring area" count, drawn in each team's flick
 * strip alongside the queue indicator (exercises the new `Gfx2D` text API).
 * World-unit font so it scales with the field like the orbs and indicators.
 */
export const SCORE_TEXT = {
  fontFamily: 'sans-serif',
  fontWeight: 700,
  /** Font size in world units. */
  fontPx: 32,
  /** Text color. */
  color: '#D6CFD8',
} as const

/**
 * The light play-field panel the game sits on. Fills the game area (which the
 * arcade insets with equal padding), ~white, rounded corners — the shared
 * arcade gradient shows in the surrounding padding.
 */
export const PANEL = {
  /** Corner radius in world units. */
  radius: 32,
  /** Panel background fill (~90% white). */
  bg: 'rgba(255, 255, 255, 0.75)',
} as const
