/**
 * Picks one game a day to lead the launcher.
 *
 * The pick walks the registry in order, one step per day, so every game leads
 * equally often and the cards behind it keep the order they are declared in.
 * Adding a game lengthens the cycle rather than changing how it works.
 */

import { zonedParts } from '@src/displays/arcade/background/dayCycle'

/** A registry split into the day's pick and the order to show it in. */
export interface DailyOrder<T> {
  /** The game leading today. `null` only when there are no games at all. */
  featured: T | null
  /** Every game, the pick first and the rest in registry order. */
  games: readonly T[]
}

/**
 * Whole days since the Unix epoch, on the booth's own clock.
 *
 * A running count rather than a day-of-year, which restarts every January and
 * would hand out the same game two days running whenever the year's length
 * leaves the same remainder as day 1 does. With today's seven games that is
 * every common year: 365 = 52 * 7 + 1, so December 31st and January 1st both
 * land on index 1. Counting from a fixed origin always advances by exactly one,
 * whatever the registry's size.
 */
export function boothDay(epochMs: number, timeZone: string): number {
  const { year, month, day } = zonedParts(epochMs, timeZone)
  // Reading the booth's calendar date back as UTC drops the zone offset
  // entirely, so the count steps at the booth's own midnight and neither a DST
  // shift nor a runner in another zone can move a day across the boundary.
  return Math.floor(Date.UTC(year, month - 1, day) / 86_400_000)
}

/**
 * `games`, reordered so the day's pick leads.
 *
 * Hands back `games` itself when the pick already leads, so re-rendering on an
 * unchanged day gives the launcher the same array it had.
 */
export function dailyOrder<T>(games: readonly T[], day: number): DailyOrder<T> {
  if (games.length === 0) return { featured: null, games }
  // `%` keeps the sign of its left operand and the day count runs negative
  // before 1970. Only a badly wrong clock reaches that, but a negative index
  // would drop a card from the launcher rather than merely pick an odd game.
  const index = ((day % games.length) + games.length) % games.length
  const featured = games[index]
  if (index === 0) return { featured, games }
  return {
    featured,
    games: [featured, ...games.slice(0, index), ...games.slice(index + 1)],
  }
}
