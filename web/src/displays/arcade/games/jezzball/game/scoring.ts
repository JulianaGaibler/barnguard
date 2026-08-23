/**
 * Pure scoring math for JezzBall. Four tracked components:
 *
 * 1. Grid elimination: points per captured cell, accrued during play.
 * 2. Fill bonus: for capturing beyond the target percentage, at level clear.
 * 3. Time bonus: for finishing a level quickly, at level clear.
 * 4. Lives bonus: for lives carried into the clear, at level clear.
 */
import { RULES, SCORING } from './tuning'
import type { ScoreBreakdown } from './types'

/** Points awarded for a freshly-captured region. */
export function eliminationPoints(cellsCaptured: number): number {
  return cellsCaptured * SCORING.cellPoints
}

/** Bonus for the captured percentage above the target (0 when at/below it). */
export function fillBonus(capturedPct: number): number {
  return Math.round(
    SCORING.fillBonusPerPct * Math.max(0, capturedPct - RULES.targetPct),
  )
}

/** Bonus for a fast level, decaying to 0 over time. */
export function timeBonus(elapsedSec: number): number {
  return Math.max(
    0,
    Math.round(SCORING.timeBonusBase - SCORING.timePenaltyPerSec * elapsedSec),
  )
}

/** Bonus for the lives a board still holds when its level clears. */
export function livesBonus(lives: number): number {
  return Math.max(0, lives) * SCORING.lifeValue
}

/** Assemble a full breakdown of one cleared level. */
export function makeBreakdown(
  elimination: number,
  fill: number,
  time: number,
  lives: number,
): ScoreBreakdown {
  const lb = livesBonus(lives)
  return {
    elimination,
    fillBonus: fill,
    timeBonus: time,
    livesBonus: lb,
    total: elimination + fill + time + lb,
  }
}
