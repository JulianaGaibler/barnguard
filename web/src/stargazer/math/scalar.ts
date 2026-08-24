/** Small scalar helpers shared across the engine and game code. */

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
 * Step `v` toward `target` by at most `maxDelta`, stopping there rather than
 * overshooting.
 *
 * The counterpart to {@link lerp} for a value chasing a target that can change
 * while it is still moving. `lerp` needs to know where a move started and how
 * far through it is, which a value retargeted mid-flight does not have, so the
 * usual shape is a per-frame `moveToward(v, target, dt / seconds)` in an update
 * hook.
 *
 * @example
 *   // Fade a highlight in or out over `FADE` seconds, whichever way it is
 *   // currently heading.
 *   this.#t = moveToward(this.#t, this.#on ? 1 : 0, dt / FADE)
 */
export function moveToward(
  v: number,
  target: number,
  maxDelta: number,
): number {
  return v < target
    ? Math.min(target, v + maxDelta)
    : Math.max(target, v - maxDelta)
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
