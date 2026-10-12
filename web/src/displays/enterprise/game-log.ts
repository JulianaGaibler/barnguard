/**
 * Enterprise-specific game-log types + typed wrappers over the core
 * envelope-only client. This module owns the wire-level shape of records that
 * carry the `display: 'enterprise'` discriminator, so consumers inside the
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

export const DISPLAY_ID = 'enterprise'

/**
 * `'exited_germany'` and `'left_play_area'` both mean the packet got away. The
 * maps lose differently: on the German map a packet is lost by crossing the
 * coastline, on a map whose play area is bounded by the view it is lost by
 * leaving the screen sideways.
 */
export type GameEndReason = 'collision' | 'exited_germany' | 'left_play_area'

export interface EnterpriseDetails {
  display: typeof DISPLAY_ID
  /**
   * Which map the round was played on. Absent on records written before the
   * display carried more than one map, and every one of those was German, so
   * the server defaults it rather than leaving it unset.
   */
  mapId: string
  /**
   * The region's id within its own map. Only meaningful alongside `mapId`,
   * since the same string can name different regions on two maps. Keeps its
   * original field name so stored records still read.
   */
  stateId: string
  reason: GameEndReason
  escapeHeadingRad?: number
  /**
   * Snapshotted server-side. True if the score was the best on its own map when
   * recorded.
   */
  wasOverallHigh: boolean
  /**
   * Snapshotted server-side. True if the score was the best for its region, on
   * its own map, when recorded.
   */
  wasStateHigh: boolean
}

export type EnterpriseGameRecord = GameRecordEnvelope & EnterpriseDetails

export interface NewEnterpriseGame {
  display: typeof DISPLAY_ID
  score: number
  durationMs: number
  mapId: string
  stateId: string
  reason: GameEndReason
  escapeHeadingRad?: number
}

/**
 * Best scores, grouped per map. There is no display-wide best: two maps are
 * different games to a player, so one number cannot describe both, the same
 * reasoning the arcade applies across its games.
 */
export interface EnterpriseHighScores {
  display: typeof DISPLAY_ID
  /** Best score per map id. */
  byMap: Record<string, number>
  /** Best score per region, keyed by map id then region id. */
  byState: Record<string, Record<string, number>>
}

/** Empty high scores, for a failed fetch or a first boot. */
export function emptyHighScores(): EnterpriseHighScores {
  return { display: DISPLAY_ID, byMap: {}, byState: {} }
}

/** Best score on `mapId`, or 0 when nothing has been recorded there. */
export function mapHigh(scores: EnterpriseHighScores, mapId: string): number {
  return scores.byMap[mapId] ?? 0
}

/** Best score for `regionId` on `mapId`, or 0. */
export function regionHigh(
  scores: EnterpriseHighScores,
  mapId: string,
  regionId: string,
): number {
  return scores.byState[mapId]?.[regionId] ?? 0
}

/**
 * `GameRecord` from the core client (envelope + open bag) narrowed to the
 * Enterprise shape. Use only on records known to carry the display tag,
 * typically inside overlays, label rendering, or the manifest boundary.
 */
export function asEnterprise(record: GameRecord): EnterpriseGameRecord {
  return record as unknown as EnterpriseGameRecord
}

export async function fetchEnterpriseGames(
  opts: { limit?: number; offset?: number } = {},
): Promise<EnterpriseGameRecord[]> {
  const raw = await coreFetchGames({ ...opts, display: DISPLAY_ID })
  return raw.map(asEnterprise)
}

export async function recordEnterpriseGame(
  game: Omit<NewEnterpriseGame, 'display'>,
): Promise<EnterpriseGameRecord> {
  const payload: NewGame = { ...game, display: DISPLAY_ID }
  const raw = await coreRecordGame(payload)
  return asEnterprise(raw)
}

export async function fetchEnterpriseHighScores(): Promise<EnterpriseHighScores> {
  const raw: CoreHighScores = await coreFetchHighScores(DISPLAY_ID)
  return raw as unknown as EnterpriseHighScores
}
