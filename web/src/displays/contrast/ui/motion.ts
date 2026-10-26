/**
 * How the screens move. Every duration, distance and curve is here, so the feel
 * is tuned in one place. Seconds unless a name says otherwise.
 */
import { easings } from 'stargazer'

export const MOTION = {
  /** The splash leaves, and the first card comes in. */
  splashOut: 0.45,
  /** A card slides in from the right and centers. */
  slide: 0.75,
  /** The score and the clock come in. */
  hud: 0.35,
  /** A card zooms to fill the screen, and the vote buttons come with it. */
  zoom: 0.7,
  /** The buttons become the scale, and the card zooms back out. */
  morph: 0.6,
  /** The answer's labels come in under the scale. */
  labels: 0.3,
  /** How long the answer stays before the next card. */
  hold: 2,
  /** The cards line up in the strip, and the result comes in. */
  strip: 0.8,
  result: 0.5,
  /** The game over screen goes, whether to the splash or to a new run. */
  leave: 0.55,
  /** The pulse that points at the answer on the scale. */
  pulse: 1.1,
  /** The next result part starts this long after the one before it. */
  stagger: 0.1,
  /** A pressed button sinks and a release lifts it. */
  press: 0.12,
  /** Splash cards come in one after another. */
  splashCard: 0.6,
  /** A splash card blends to its next colors, and the next one follows. */
  exampleSwap: 0.7,
  exampleEvery: 1.8,
} as const

export const EASE = {
  /** Things that arrive. */
  arrive: easings.outCubic,
  /** Things that leave. */
  leave: easings.inCubic,
  /** Things that move between two places. */
  move: easings.inOutCubic,
  /** Things that run on a clock of their own. */
  linear: easings.linear,
} as const

/** Linear interpolation. */
export function lerp(from: number, to: number, t: number): number {
  return from + (to - from) * t
}

/** `value` held between 0 and 1. */
export function clamp01(value: number): number {
  return Math.min(Math.max(value, 0), 1)
}
