/**
 * Small scalar helpers shared across the engine and game code.
 *
 * @category Math
 */

/** Clamp `v` to the inclusive range `[lo, hi]`. */
export function clamp(v: number, lo: number, hi: number): number {
  return v < lo ? lo : v > hi ? hi : v
}

/** Clamp `v` to `[-max, max]`. */
export function clampAbs(v: number, max: number): number {
  if (v > max) return max
  if (v < -max) return -max
  return v
}

/**
 * Linear interpolation: `t=0` returns `a`, `t=1` returns `b`. `t` is not
 * clamped.
 */
export function lerp(a: number, b: number, t: number): number {
  return a + (b - a) * t
}

/**
 * Interpolate between two angles (radians) along the shortest arc, so it wraps
 * across ±π instead of taking the long way around.
 */
export function lerpAngle(a: number, b: number, t: number): number {
  const twoPi = Math.PI * 2
  let diff = ((b - a + Math.PI) % twoPi) - Math.PI
  if (diff < -Math.PI) diff += twoPi
  return a + diff * t
}
