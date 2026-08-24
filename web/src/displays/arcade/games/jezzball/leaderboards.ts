/**
 * JezzBall's ranked board.
 *
 * One constant so the board this game declares and the board it submits to
 * cannot drift: `meta.ts` publishes it to the launcher and the attendant panel,
 * and the game-over overlays send scores to it.
 */
import type { LeaderboardBoard } from '../GameModule'

export const JEZZBALL_LEADERBOARDS: readonly LeaderboardBoard[] = [
  { id: 'jezzball', label: 'Scores' },
]

/** The `display` key for every score this game submits. */
export const JEZZBALL_BOARD_ID = JEZZBALL_LEADERBOARDS[0].id
