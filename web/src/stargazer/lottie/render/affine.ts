// Small 2D affine helpers on `Float64Array(6)` in the order `a, b, c, d, e, f`,
// the same as a DOMMatrix: a point maps to `(a*x + c*y + e, b*x + d*y + f)`.
// They write into caller-owned arrays so evaluating a frame allocates nothing.

import type { LottieTransform } from '../model/types'

export type Affine = Float64Array

/** A new identity matrix. */
export function identity(): Affine {
  const m = new Float64Array(6)
  m[0] = 1
  m[3] = 1
  return m
}

export function setIdentity(m: Affine): void {
  m[0] = 1
  m[1] = 0
  m[2] = 0
  m[3] = 1
  m[4] = 0
  m[5] = 0
}

/** `out = a × b`, so `b` applies first. `out` may alias `a` or `b`. */
export function multiply(out: Affine, a: Affine, b: Affine): void {
  const a0 = a[0]
  const a1 = a[1]
  const a2 = a[2]
  const a3 = a[3]
  const a4 = a[4]
  const a5 = a[5]
  const b0 = b[0]
  const b1 = b[1]
  const b2 = b[2]
  const b3 = b[3]
  out[0] = a0 * b0 + a2 * b1
  out[1] = a1 * b0 + a3 * b1
  out[2] = a0 * b2 + a2 * b3
  out[3] = a1 * b2 + a3 * b3
  out[4] = a0 * b[4] + a2 * b[5] + a4
  out[5] = a1 * b[4] + a3 * b[5] + a5
}

const DEG = Math.PI / 180

/** Skew angles within this many radians of a right angle are held back. */
const MAX_SKEW = Math.PI / 2 - 1e-3

const TMP2 = new Float64Array(2)
const TMP1 = new Float64Array(1)

/**
 * Compose a Lottie transform sampled at `frame` into `out`: translate to the
 * position, rotate, skew, scale, then move the anchor to the origin. Returns
 * the opacity in `[0, 1]`.
 */
export function sampleTransform(
  t: LottieTransform,
  frame: number,
  out: Affine,
): number {
  t.anchor.sample(frame, TMP2)
  const ax = TMP2[0]
  const ay = TMP2[1]
  let px: number
  let py: number
  if (t.position) {
    t.position.sample(frame, TMP2)
    px = TMP2[0]
    py = TMP2[1]
  } else {
    px = t.positionX ? t.positionX.get(frame) : 0
    py = t.positionY ? t.positionY.get(frame) : 0
  }
  t.scale.sample(frame, TMP2)
  const sx = TMP2[0] / 100
  const sy = TMP2[1] / 100
  const rot = t.rotation.get(frame) * DEG
  t.skew.sample(frame, TMP1)
  // A positive Lottie skew leans the other way from the engine's convention.
  let skew = -TMP1[0] * DEG
  if (skew > MAX_SKEW) skew = MAX_SKEW
  else if (skew < -MAX_SKEW) skew = -MAX_SKEW
  const skewAxis = t.skewAxis.get(frame) * DEG

  // M = T(p) · R · Skew · S · T(-a)
  const cr = Math.cos(rot)
  const sr = Math.sin(rot)
  let a = cr
  let b = sr
  let c = -sr
  let d = cr
  if (skew !== 0) {
    const k = Math.tan(skew)
    const ca = Math.cos(skewAxis)
    const sa = Math.sin(skewAxis)
    const ka = 1 - ca * sa * k
    const kb = -sa * sa * k
    const kc = ca * ca * k
    const kd = 1 + ca * sa * k
    // (a b c d) = R × Skew
    const na = a * ka + c * kb
    const nb = b * ka + d * kb
    const nc = a * kc + c * kd
    const nd = b * kc + d * kd
    a = na
    b = nb
    c = nc
    d = nd
  }
  // × S
  a *= sx
  b *= sx
  c *= sy
  d *= sy
  out[0] = a
  out[1] = b
  out[2] = c
  out[3] = d
  out[4] = px - (a * ax + c * ay)
  out[5] = py - (b * ax + d * ay)
  const o = t.opacity.get(frame) / 100
  return o < 0 ? 0 : o > 1 ? 1 : o
}
