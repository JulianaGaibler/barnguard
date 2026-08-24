/**
 * What a lock is worth.
 *
 * The shape of the table is the familiar one and the reasoning behind it is
 * worth keeping in view: clearing four rows at once is worth eight singles, so
 * the game rewards building a well and waiting rather than clearing the moment
 * anything lines up. Twists and streaks extend the same idea further up the
 * skill range.
 */
import type { TwistKind } from './types'

/** Base points per line count, before the level multiplier. Index is lines. */
const LINE_POINTS = [0, 100, 300, 500, 800] as const

/** A twist with no lines cleared. Index is 0 for mini, 1 for full. */
const TWIST_BARE = { mini: 100, full: 400 } as const

/** Base points for a twist that also cleared. Index is lines. */
const TWIST_POINTS = {
  mini: [0, 200, 400, 0, 0],
  full: [0, 800, 1200, 1600, 0],
} as const

/** Points per combo step, before the level multiplier. */
const COMBO_STEP = 50

/** Multiplier on a clear that keeps a streak alive. */
const STREAK_MULTIPLIER = 1.5

/** Points per cell for each kind of drop, unaffected by level. */
const SOFT_DROP_PER_CELL = 1
const HARD_DROP_PER_CELL = 2

/** The four-row clear, which is the one the whole table is built around. */
export const FLUSH_LINES = 4

/** Everything about one lock that bears on its score. */
export interface ClearOutcome {
  lines: number
  twist: TwistKind
  /** The level in force when the piece locked. */
  level: number
  /**
   * Consecutive clears before this one, so the first clear of a run is zero. A
   * lock that clears nothing ends the run.
   */
  combo: number
  /** Whether the previous scoring clear was itself streak-eligible. */
  streak: boolean
}

/**
 * Whether a clear keeps a streak alive.
 *
 * A streak survives on the hard clears only: a full buffer flush, or any twist
 * that cleared. Anything else breaks it, which is what stops a player holding a
 * multiplier open with singles.
 */
export function isStreakEligible(lines: number, twist: TwistKind): boolean {
  if (lines === 0) return false
  return lines === FLUSH_LINES || twist !== 'none'
}

/** Points for one lock, level multiplier and all bonuses applied. */
export function clearPoints(o: ClearOutcome): number {
  const base =
    o.twist === 'none'
      ? LINE_POINTS[Math.min(o.lines, FLUSH_LINES)]
      : o.lines === 0
        ? TWIST_BARE[o.twist]
        : TWIST_POINTS[o.twist][Math.min(o.lines, FLUSH_LINES)]

  let points = base * o.level
  // The multiplier applies only where a streak can be earned, so a streak
  // running through a single does not quietly inflate it.
  if (o.streak && isStreakEligible(o.lines, o.twist)) {
    points = Math.floor(points * STREAK_MULTIPLIER)
  }
  // The combo counts consecutive clears, so it is only paid when one happened.
  if (o.lines > 0 && o.combo > 0) points += COMBO_STEP * o.combo * o.level
  return points
}

/** Points for a hard drop, paid per cell fallen whether or not it clears. */
export function hardDropPoints(cells: number): number {
  return cells * HARD_DROP_PER_CELL
}

/** Points for holding soft drop, paid per cell fallen. */
export function softDropPoints(cells: number): number {
  return cells * SOFT_DROP_PER_CELL
}
