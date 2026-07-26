/**
 * An easing function. Maps normalized time `t` in `[0, 1]` to an eased progress
 * value. Most return `[0, 1]`, but overshoot easings ({@link outBack},
 * {@link outElastic}) can leave that range mid-curve before settling on 1.
 *
 * @category Math
 */
export type Easing = (t: number) => number

/** No easing. Progress equals time. */
export const linear: Easing = (t) => t

/** Quadratic ease-in. Starts slow, accelerates. */
export const inQuad: Easing = (t) => t * t
/** Quadratic ease-out. Starts fast, decelerates. */
export const outQuad: Easing = (t) => 1 - (1 - t) * (1 - t)
/** Quadratic ease-in-out. Slow at both ends, fast in the middle. */
export const inOutQuad: Easing = (t) =>
  t < 0.5 ? 2 * t * t : 1 - Math.pow(-2 * t + 2, 2) / 2

/** Cubic ease-in. Steeper acceleration than {@link inQuad}. */
export const inCubic: Easing = (t) => t * t * t
/** Cubic ease-out. Steeper deceleration than {@link outQuad}. */
export const outCubic: Easing = (t) => 1 - Math.pow(1 - t, 3)
/** Cubic ease-in-out. */
export const inOutCubic: Easing = (t) =>
  t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2

/** Quintic ease-out. A long, soft tail into the end value. */
export const outQuint: Easing = (t) => 1 - Math.pow(1 - t, 5)

/**
 * Build an ease-out that overshoots past 1 by a tunable amount before settling.
 * `overshoot` 0 removes the overshoot; the default {@link outBack} uses
 * `1.70158` (a ~10% overshoot).
 */
export function makeOutBack(overshoot: number): Easing {
  const c3 = overshoot + 1
  return (t) => {
    const x = t - 1
    return 1 + c3 * x * x * x + overshoot * x * x
  }
}

/** Ease-out that overshoots past 1, then settles back. */
export const outBack: Easing = makeOutBack(1.70158)

const ELASTIC_C4 = (2 * Math.PI) / 3
/** Ease-out that oscillates around 1 with decaying amplitude before settling. */
export const outElastic: Easing = (t) => {
  if (t === 0 || t === 1) return t
  return Math.pow(2, -10 * t) * Math.sin((t * 10 - 0.75) * ELASTIC_C4) + 1
}

/**
 * Build an ease-out that treats 1 as a hard floor: a gravity-driven fall
 * (accelerating, since it starts from rest) hits the floor, then bounces — a
 * series of parabolic arcs, each carrying `elasticity` times the previous arc's
 * impact speed, so both the height (∝ speed²) and duration (∝ speed) shrink
 * every bounce. That's what makes a real bounce read as a bounce rather than a
 * spring: the oscillation speeds up as it dies out, unlike {@link outElastic}'s
 * constant-frequency ringing. Unlike {@link outBack}, the curve never crosses
 * past 1 — only back below it, mid-air.
 *
 * `elasticity` is the speed fraction kept per bounce (0 disables bouncing);
 * `firstBounceHeight` is how far the first bounce lifts back off the floor, as
 * a fraction of the fall; `bounces` is how many arcs to render before
 * settling.
 */
export function makeOutBounce(
  elasticity: number,
  firstBounceHeight: number,
  bounces: number,
): Easing {
  // Arc 0 is the fall; arcs 1..bounces are the bounces. Raw arc durations
  // decay geometrically by `elasticity` (duration ∝ impact speed); normalize
  // so they sum to 1 (the whole eased range).
  const rawDurations = [1]
  for (let k = 1; k <= bounces; k++) {
    rawDurations.push(rawDurations[k - 1] * elasticity)
  }
  const rawTotal = rawDurations.reduce((sum, d) => sum + d, 0)
  const durations = rawDurations.map((d) => d / rawTotal)
  const starts = durations.reduce<number[]>(
    (acc, d) => [...acc, acc[acc.length - 1] + d],
    [0],
  )
  // Bounce height ∝ impact speed², i.e. ∝ (raw duration)².
  const heights = rawDurations.map(
    (d) => firstBounceHeight * (d / rawDurations[1]) ** 2,
  )

  return (t) => {
    if (t >= 1) return 1
    let arc = 0
    while (arc < bounces && t >= starts[arc + 1]) arc++
    const u = (t - starts[arc]) / durations[arc]
    if (arc === 0) return inQuad(u)
    // A parabolic rise-and-fall: 0 at both ends of the arc, peaking at the
    // bounce height halfway through.
    return 1 - heights[arc] * 4 * u * (1 - u)
  }
}

/** Ease-out that settles onto 1 as a hard floor with a couple of real bounces. */
export const outBounce: Easing = makeOutBounce(0.4, 0.14, 2)
