/**
 * When the arcade gives up on the person in front of it.
 *
 * A visitor can walk off mid-game, leaving the next one to find a stranger's
 * board. After {@link IDLE_QUIT_MS} without input the arcade quits whatever is
 * running and puts the launcher back the way it opens. The last
 * {@link IDLE_WARN_MS} of that are spent showing a notice, so someone still
 * standing there can cancel it with a touch.
 */

/** No input for this long returns the arcade to its opening state. */
export const IDLE_QUIT_MS = 10 * 60_000

/** How long the notice counts down before the quit. */
export const IDLE_WARN_MS = 30_000

/**
 * How often the arcade re-reads the idle clock.
 *
 * Both edges come from the same tick, so the notice's countdown ring and the
 * quit agree to within one interval.
 */
export const IDLE_POLL_MS = 250

/** True once the countdown notice belongs on screen. */
export function isWarning(idleMs: number): boolean {
  return idleMs >= IDLE_QUIT_MS - IDLE_WARN_MS
}

/** True once the arcade should reset itself. */
export function isExpired(idleMs: number): boolean {
  return idleMs >= IDLE_QUIT_MS
}
