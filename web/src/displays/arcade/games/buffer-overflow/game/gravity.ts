/**
 * How fast pieces fall, and when the level climbs.
 *
 * The curve is the familiar exponential one: each level multiplies the fall
 * time by a factor that itself shrinks, so the early levels ease in and the
 * late ones collapse toward instant. Past {@link MAX_LEVEL} it stops getting
 * faster, because below the floor the difference is no longer something a
 * player can perceive or react to, and the level number keeps climbing as a
 * score multiplier alone.
 */
import { clamp } from '@src/stargazer'

/** Lines to clear before the level ticks up. */
export const LINES_PER_LEVEL = 10

/** Where the gravity curve stops steepening. Levels past this still count. */
export const MAX_LEVEL = 20

/**
 * Floor on the fall time, in seconds per row.
 *
 * Defensive rather than a design knob. It sits an order of magnitude below
 * anything the curve reaches at {@link MAX_LEVEL}, and exists only to keep the
 * step positive and finite if the constants above are ever retuned far enough
 * to drive the base toward zero.
 *
 * What keeps the top of the curve playable is the lock delay, not gravity. By
 * level 20 a piece reaches the stack in a few milliseconds, and the half second
 * it then rests there is the whole of the player's thinking time.
 */
export const MIN_SECONDS_PER_ROW = 1 / 100_000

/** Level for a running line count, starting at 1. */
export function levelForLines(lines: number): number {
  return 1 + Math.floor(lines / LINES_PER_LEVEL)
}

/** Seconds a piece takes to fall one row at `level`. */
export function secondsPerRow(level: number): number {
  const capped = clamp(level, 1, MAX_LEVEL)
  const base = 0.8 - (capped - 1) * 0.007
  return Math.max(MIN_SECONDS_PER_ROW, Math.pow(base, capped - 1))
}

/**
 * How much faster a held soft drop falls than the level's own gravity.
 *
 * A multiple rather than a fixed rate, so it stays a real speed-up at the top
 * of the curve where gravity has overtaken any fixed number.
 *
 * The guideline figure for this is twenty, which at level 1 is twenty-five rows
 * a second: a tap crosses most of the buffer, so the control is only usable as
 * an all-or-nothing drop. Softer, it becomes what the name says, a way to hurry
 * a piece down a few rows and still stop where it was aimed.
 */
export const SOFT_DROP_FACTOR = 3

/**
 * The slowest a soft drop will ever go, in seconds per row.
 *
 * A plain multiple of the early levels is barely a speed-up, because gravity
 * starts near a row a second. This floor makes the control worth pressing from
 * the first piece, and gravity outruns it by level 6 or so, after which
 * {@link SOFT_DROP_FACTOR} is what is doing the work.
 */
export const SOFT_DROP_SLOWEST = 0.11

/** Seconds per row while soft drop is held. */
export function softDropSecondsPerRow(level: number): number {
  return Math.max(
    MIN_SECONDS_PER_ROW,
    Math.min(SOFT_DROP_SLOWEST, secondsPerRow(level) / SOFT_DROP_FACTOR),
  )
}
