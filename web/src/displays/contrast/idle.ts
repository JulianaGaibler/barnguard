/**
 * When the display gives up on the person in front of it.
 *
 * A visitor can walk off mid-game or leave the game over card showing. After
 * {@link IDLE_RESET_MS} without input on any screen but the splash, the display
 * returns to the splash and forgets the run. The last {@link IDLE_WARN_MS} of
 * that show a notice, so someone still looking can cancel it with a touch. The
 * splash itself never times out.
 */

/** No input for this long returns to the splash. */
export const IDLE_RESET_MS = 60_000

/** How long the notice counts down before the reset. */
export const IDLE_WARN_MS = 10_000

/** How often the display reads the idle clock. */
export const IDLE_POLL_MS = 250

/** True once the countdown notice belongs on screen. */
export function isWarning(idleMs: number): boolean {
  return idleMs >= IDLE_RESET_MS - IDLE_WARN_MS
}

/** True once the display should reset itself. */
export function isExpired(idleMs: number): boolean {
  return idleMs >= IDLE_RESET_MS
}
