/**
 * Stallwächter-specific game-log types + typed wrappers over the core
 * envelope-only client. This module owns the wire-level shape of records that
 * carry the `display: 'stallwaechter'` discriminator, so consumers inside the
 * display can read fields with real types (rather than the `unknown` bag core
 * exposes).
 */

import {
  fetchGames as coreFetchGames,
  fetchHighScores as coreFetchHighScores,
  recordGame as coreRecordGame,
  type GameRecord,
  type GameRecordEnvelope,
  type HighScores as CoreHighScores,
  type NewGame,
} from '@src/core/game-log/gameLogClient'

export const DISPLAY_ID = 'stallwaechter'

export type GameEndReason = 'collision' | 'exited_germany'

export interface StallwaechterDetails {
  display: typeof DISPLAY_ID
  stateId: string
  reason: GameEndReason
  escapeHeadingRad?: number
  /**
   * Snapshotted server-side; true iff the score was the overall best when
   * recorded.
   */
  wasOverallHigh: boolean
  /**
   * Snapshotted server-side; true iff the score was the best for its state when
   * recorded.
   */
  wasStateHigh: boolean
}

export type StallwaechterGameRecord = GameRecordEnvelope & StallwaechterDetails

export interface NewStallwaechterGame {
  display: typeof DISPLAY_ID
  score: number
  durationMs: number
  stateId: string
  reason: GameEndReason
  escapeHeadingRad?: number
}

export interface StallwaechterHighScores {
  display: typeof DISPLAY_ID
  overall: number
  byState: Record<string, number>
}

/**
 * `GameRecord` from the core client (envelope + open bag) narrowed to the
 * Stallwächter shape. Use only on records known to carry the display tag —
 * typically inside overlays, label rendering, or the manifest boundary.
 */
export function asStallwaechter(record: GameRecord): StallwaechterGameRecord {
  return record as unknown as StallwaechterGameRecord
}

export async function fetchStallwaechterGames(
  opts: { limit?: number; offset?: number } = {},
): Promise<StallwaechterGameRecord[]> {
  const raw = await coreFetchGames({ ...opts, display: DISPLAY_ID })
  return raw.map(asStallwaechter)
}

export async function recordStallwaechterGame(
  game: Omit<NewStallwaechterGame, 'display'>,
): Promise<StallwaechterGameRecord> {
  const payload: NewGame = { ...game, display: DISPLAY_ID }
  const raw = await coreRecordGame(payload)
  return asStallwaechter(raw)
}

export async function fetchStallwaechterHighScores(): Promise<StallwaechterHighScores> {
  const raw: CoreHighScores = await coreFetchHighScores(DISPLAY_ID)
  return raw as unknown as StallwaechterHighScores
}
