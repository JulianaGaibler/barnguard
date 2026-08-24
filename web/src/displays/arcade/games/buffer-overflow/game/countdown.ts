/**
 * Countdown's clock: it runs down on its own and every clear puts time back.
 *
 * The extension curve is convex on purpose. A four-row flush returns seven
 * times what a single does, so the pressure pushes a player toward building a
 * well and cashing it in rather than chipping a row off whenever one lines up.
 * Clearing fast is not the same as clearing well, and the clock should reward
 * the second.
 *
 * The cap is what keeps it a countdown. A strong player at a high level banks
 * time faster than they spend it, and without a ceiling the clock ratchets up
 * until it stops being a constraint and the mode quietly turns back into
 * Uptime. Time can be held, never accumulated.
 */

/** Seconds on the clock at the start of a run, and its ceiling thereafter. */
export const START_SECONDS = 45

/** Seconds returned per clear, indexed by lines. */
export const EXTENSION_SECONDS = [0, 2, 5, 9, 14] as const

/** Below this the clock reads as urgent and the readout changes color. */
export const URGENT_SECONDS = 10

/** A running clock. */
export interface Countdown {
  remaining: number
}

export function createCountdown(): Countdown {
  return { remaining: START_SECONDS }
}

/** Put a run's worth of time back, up to the ceiling. */
export function extend(clock: Countdown, lines: number): number {
  if (lines <= 0) return 0
  const idx = Math.min(lines, EXTENSION_SECONDS.length - 1)
  const before = clock.remaining
  clock.remaining = Math.min(START_SECONDS, before + EXTENSION_SECONDS[idx])
  // The granted amount, not the tabled one: near the ceiling a flush is worth
  // less than its fourteen seconds, and the readout should say what happened.
  return clock.remaining - before
}

/** Run the clock down. Returns true once it has expired. */
export function tick(clock: Countdown, dt: number): boolean {
  clock.remaining = Math.max(0, clock.remaining - dt)
  return clock.remaining <= 0
}

/** Whether the clock is low enough to warn about. */
export function isUrgent(remaining: number): boolean {
  return remaining <= URGENT_SECONDS
}

/** `M:SS`, for the readout. */
export function formatClock(seconds: number): string {
  const whole = Math.max(0, Math.ceil(seconds))
  const m = Math.floor(whole / 60)
  const s = whole % 60
  return `${m}:${String(s).padStart(2, '0')}`
}
