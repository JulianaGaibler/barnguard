/**
 * Data Control's ranked board.
 *
 * One constant so the board this game declares and the board it submits to
 * cannot drift: `meta.ts` publishes it to the launcher and the attendant panel,
 * and the game-over overlays send scores to it.
 */
import type { LeaderboardBoard } from '../GameModule'

export const DATA_CONTROL_LEADERBOARDS: readonly LeaderboardBoard[] = [
  { id: 'data-control', label: 'Scores' },
]

/** The `display` key for every score this game submits. */
export const DATA_CONTROL_BOARD_ID = DATA_CONTROL_LEADERBOARDS[0].id
