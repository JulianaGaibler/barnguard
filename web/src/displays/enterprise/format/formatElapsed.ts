/**
 * A duration as `m:ss`, with the minutes unbounded and the seconds padded to
 * two digits. Partial seconds are dropped, so `59.9` reads `0:59` and the clock
 * never runs ahead of the time that has passed.
 *
 * A negative or non-finite duration reads as `0:00`.
 *
 * @example
 *   formatElapsed(48) // "0:48"
 *   formatElapsed(3661) // "61:01"
 */
export function formatElapsed(seconds: number): string {
  const whole = Number.isFinite(seconds) ? Math.max(0, Math.floor(seconds)) : 0
  const minutes = Math.floor(whole / 60)
  const rest = whole % 60
  return `${minutes}:${String(rest).padStart(2, '0')}`
}
