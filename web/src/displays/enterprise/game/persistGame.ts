import { printerLive } from '@src/core/print/printerClient'
import { onReconnect } from '@src/core/print/reconnect'
import type { RegionId } from './maps'
import {
  fetchEnterpriseHighScores,
  recordEnterpriseGame,
  type GameEndReason as WireGameEndReason,
  type EnterpriseGameRecord as GameRecord,
  type EnterpriseHighScores as HighScores,
} from '../game-log'

export interface Persisted {
  record: GameRecord
  highScores: HighScores
}

/**
 * Post the finished game, then fetch the high scores as they stand with it.
 * When either step fails, both are retried from the step that failed each time
 * the backend connection comes back online, so a game finished while the server
 * is down still lands once it is back. `onDone` runs once, when both have.
 */
export function persistFinishedGame(
  input: {
    mapId: string
    stateId: RegionId
    reason: WireGameEndReason
    score: number
    durationMs: number
    escapeHeadingRad?: number
  },
  onDone: (persisted: Persisted) => void,
): void {
  let record: GameRecord | null = null
  let busy = false
  let unwatch: (() => void) | null = null
  const attempt = async (): Promise<void> => {
    if (busy) return
    busy = true
    try {
      record ??= await recordEnterpriseGame({
        score: input.score,
        durationMs: input.durationMs,
        mapId: input.mapId,
        stateId: input.stateId,
        reason: input.reason,
        escapeHeadingRad: input.escapeHeadingRad,
      })
      const highScores = await fetchEnterpriseHighScores()
      unwatch?.()
      unwatch = null
      onDone({ record, highScores })
    } catch (e) {
      console.warn('[session] failed to persist game to server', e)
      unwatch ??= onReconnect(printerLive, () => void attempt())
    } finally {
      busy = false
    }
  }
  void attempt()
}
