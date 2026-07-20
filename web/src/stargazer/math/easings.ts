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
