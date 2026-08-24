/**
 * 2048's ranked board.
 *
 * One constant so the board this game declares and the board it submits to
 * cannot drift: `meta.ts` publishes it to the launcher and the attendant panel,
 * and the game-over overlays send scores to it.
 */
import type { LeaderboardBoard } from '../GameModule'

export const TWENTY48_LEADERBOARDS: readonly LeaderboardBoard[] = [
  { id: '2048', label: 'Scores' },
]

/** The `display` key for every score this game submits. */
export const TWENTY48_BOARD_ID = TWENTY48_LEADERBOARDS[0].id
