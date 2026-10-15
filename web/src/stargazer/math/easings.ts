/**
 * An easing function. Maps normalized time `t` in `[0, 1]` to an eased progress
 * value. Most return `[0, 1]`, but overshoot easings ({@link outBack},
 * {@link outElastic}) can leave that range mid-curve before settling on 1.
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

const BEZIER_SAMPLES = 11
const BEZIER_STEP = 1 / (BEZIER_SAMPLES - 1)
const BEZIER_NEWTON_MIN_SLOPE = 0.001

/**
 * Build a CSS-style `cubic-bezier(x1, y1, x2, y2)` easing. The curve runs from
 * (0, 0) to (1, 1) through the two control points. `x1` and `x2` must be in
 * `[0, 1]` so that time stays a function of progress. `y1` and `y2` may leave
 * that range to overshoot.
 *
 * @remarks
 *   Engine developers: solving for `t` given `x` uses an 11-entry sample table to
 *   pick a starting guess, then up to 4 Newton iterations, and falls back to
 *   bisection where the slope is too flat for Newton. When both control points
 *   lie on the diagonal the curve is linear and the identity function is
 *   returned. The returned closure allocates nothing per call.
 * @example
 *   // Same as CSS `ease-in-out`.
 *   const e = cubicBezier(0.42, 0, 0.58, 1)
 *   e(0.5) // 0.5
 */
export function cubicBezier(
  x1: number,
  y1: number,
  x2: number,
  y2: number,
): Easing {
  if (x1 === y1 && x2 === y2) return linear
  const ax = 1 - 3 * x2 + 3 * x1
  const bx = 3 * x2 - 6 * x1
  const cx = 3 * x1
  const ay = 1 - 3 * y2 + 3 * y1
  const by = 3 * y2 - 6 * y1
  const cy = 3 * y1
  const sampleX = (t: number) => ((ax * t + bx) * t + cx) * t
  const slopeX = (t: number) => (3 * ax * t + 2 * bx) * t + cx
  const table = new Float64Array(BEZIER_SAMPLES)
  for (let i = 0; i < BEZIER_SAMPLES; i++) table[i] = sampleX(i * BEZIER_STEP)

  const solveT = (x: number): number => {
    let start = 0
    let i = 1
    for (; i < BEZIER_SAMPLES - 1 && table[i] <= x; i++) start += BEZIER_STEP
    i--
    const dist = (x - table[i]) / (table[i + 1] - table[i])
    let t = start + dist * BEZIER_STEP
    const slope = slopeX(t)
    if (slope >= BEZIER_NEWTON_MIN_SLOPE) {
      for (let n = 0; n < 4; n++) {
        const s = slopeX(t)
        if (s === 0) return t
        t -= (sampleX(t) - x) / s
      }
      return t
    }
    if (slope === 0) return t
    let lo = start
    let hi = start + BEZIER_STEP
    for (let n = 0; n < 12; n++) {
      t = (lo + hi) / 2
      if (sampleX(t) > x) hi = t
      else lo = t
    }
    return t
  }

  return (x) => {
    if (x <= 0) return 0
    if (x >= 1) return 1
    const t = solveT(x)
    return ((ay * t + by) * t + cy) * t
  }
}

/**
 * Build an ease-out that overshoots past 1 by a tunable amount before settling.
 * `overshoot` 0 removes the overshoot. The default {@link outBack} uses
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
 * Build an ease-out that treats 1 as a hard floor. A gravity-driven fall
 * (accelerating, since it starts from rest) hits the floor, then bounces: a
 * series of parabolic arcs, each carrying `elasticity` times the previous arc's
 * impact speed, so both the height (∝ speed²) and duration (∝ speed) shrink
 * every bounce. That's what makes a real bounce read as a bounce rather than a
 * spring, since the oscillation speeds up as it dies out, unlike
 * {@link outElastic}'s constant-frequency ringing. Unlike {@link outBack}, the
 * curve never crosses past 1, only back below it, mid-air.
 *
 * `elasticity` is the speed fraction kept per bounce (0 disables bouncing).
 * `firstBounceHeight` is how far the first bounce lifts back off the floor, as
 * a fraction of the fall. `bounces` is how many arcs to render before
 * settling.
 */
export function makeOutBounce(
  elasticity: number,
  firstBounceHeight: number,
  bounces: number,
): Easing {
  // Arc 0 is the fall. Arcs 1..bounces are the bounces. Raw arc durations
  // decay geometrically by `elasticity` (duration ∝ impact speed), normalized
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
