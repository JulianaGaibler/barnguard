export type Easing = (t: number) => number

export const linear: Easing = (t) => t

export const inQuad: Easing = (t) => t * t
export const outQuad: Easing = (t) => 1 - (1 - t) * (1 - t)
export const inOutQuad: Easing = (t) =>
  t < 0.5 ? 2 * t * t : 1 - Math.pow(-2 * t + 2, 2) / 2

export const inCubic: Easing = (t) => t * t * t
export const outCubic: Easing = (t) => 1 - Math.pow(1 - t, 3)
export const inOutCubic: Easing = (t) =>
  t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2

export const outQuint: Easing = (t) => 1 - Math.pow(1 - t, 5)

const BACK_C1 = 1.70158
const BACK_C3 = BACK_C1 + 1
export const outBack: Easing = (t) => {
  const x = t - 1
  return 1 + BACK_C3 * x * x * x + BACK_C1 * x * x
}

const ELASTIC_C4 = (2 * Math.PI) / 3
export const outElastic: Easing = (t) => {
  if (t === 0 || t === 1) return t
  return Math.pow(2, -10 * t) * Math.sin((t * 10 - 0.75) * ELASTIC_C4) + 1
}
