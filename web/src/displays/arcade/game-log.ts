/**
 * Arcade-specific game-log types + typed wrappers over the core envelope-only
 * client. This module owns the wire-level shape of records that carry the
 * `display: 'arcade'` discriminator, so consumers inside the display can read
 * fields with real types (rather than the `unknown` bag core exposes).
 *
 * The arcade hosts five games with incompatible scoring scales (Jezzball's
 * points vs. Connect Four's/Orbo's round-win streaks vs. Data Control's timer),
 * so high scores are grouped per `gameId` rather than tracked as a single
 * arcade-wide "overall" — see `ArcadeHighScores`.
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

export const DISPLAY_ID = 'arcade'

export interface ArcadeDetails {
  display: typeof DISPLAY_ID
  /** The arcade `GameMeta.id`, e.g. `'jezzball'`, `'connect-four'`, `'orbo'`. */
  gameId: string
  /** Free-form mode tag, e.g. `'solo'`, `'versus'`, `'round'`. */
  mode: string
  /** Human-readable winning side (e.g. `'player1'`, `'left'`, `'tie'`). */
  winner?: string
  /**
   * Snapshotted server-side; true iff the score was the best for this `gameId`
   * when recorded.
   */
  wasGameHigh: boolean
  /** The name the player saved to the leaderboard for this run, if any. */
  playerName?: string
}

export type ArcadeGameRecord = GameRecordEnvelope & ArcadeDetails

export interface NewArcadeGame {
  display: typeof DISPLAY_ID
  score: number
  durationMs: number
  gameId: string
  mode: string
  winner?: string
  playerName?: string
}

export interface ArcadeHighScores {
  display: typeof DISPLAY_ID
  byGame: Record<string, number>
}

/**
 * `GameRecord` from the core client (envelope + open bag) narrowed to the
 * arcade shape. Use only on records known to carry the display tag — typically
 * inside the attendant panel or the manifest boundary.
 */
export function asArcade(record: GameRecord): ArcadeGameRecord {
  return record as unknown as ArcadeGameRecord
}

export async function fetchArcadeGames(
  opts: { limit?: number; offset?: number } = {},
): Promise<ArcadeGameRecord[]> {
  const raw = await coreFetchGames({ ...opts, display: DISPLAY_ID })
  return raw.map(asArcade)
}

/** Persist a finished arcade game. Called once per game, regardless of score. */
export async function recordArcadeGame(
  game: Omit<NewArcadeGame, 'display'>,
): Promise<ArcadeGameRecord> {
  const payload: NewGame = { ...game, display: DISPLAY_ID }
  const raw = await coreRecordGame(payload)
  return asArcade(raw)
}

export async function fetchArcadeHighScores(): Promise<ArcadeHighScores> {
  const raw: CoreHighScores = await coreFetchHighScores(DISPLAY_ID)
  return raw as unknown as ArcadeHighScores
}
