/**
 * World-unit and timing knobs for Connect Four. The board sizes itself to the
 * arcade game bounds (see the session), so geometry here is fractions and gaps,
 * not absolute sizes.
 */
import type { Difficulty, Player } from './types'

/** Disc fill per player. 1 = blue (left), 2 = red (right / AI). */
export const PLAYER_COLORS: Record<Player, string> = {
  1: '#4A90E2',
  2: '#E24A4A',
}

/** The rounded board panel the grid of holes is cut from. */
export const BOARD = {
  /** Corner radius in world units. */
  radius: 32,
  /** Panel fill (opaque so discs read cleanly through the holes). */
  bg: 'rgba(247, 244, 250, 0.96)',
  /** Hole radius as a fraction of the cell size. */
  holeRadiusFrac: 0.38,
  /** Disc radius as a fraction of the cell size (a touch smaller than the hole). */
  discRadiusFrac: 0.34,
} as const

/** AI search depth and blunder rate per difficulty (see the stargazer AI guide). */
export const AI_LEVELS: Record<
  Difficulty,
  { depth: number; blunderChance: number }
> = {
  easy: { depth: 2, blunderChance: 0.3 },
  medium: { depth: 4, blunderChance: 0 },
  hard: { depth: 7, blunderChance: 0 },
}

/** Animation timings (seconds). */
export const ANIM = {
  /** Base drop time plus per-row travel, so a longer fall takes longer. */
  dropBase: 0.16,
  dropPerRow: 0.035,
  /** Board fade-in on match start. */
  revealOpen: 0.4,
  /** Board fade-out when returning to the main screen. */
  foldClose: 0.3,
  /** Winning-line pulse before the burst. */
  winPulse: 0.5,
  /** Hold on the result before folding back to the main screen. */
  winHold: 2.0,
  /** Pause before the AI plays, so its move reads as a decision. */
  aiThinkDelay: 0.45,
} as const
