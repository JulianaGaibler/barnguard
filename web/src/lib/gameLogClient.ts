/**
 * Typed client for the server-side game log (`/api/games`), including a Svelte
 * store (`gamesLive`) that mirrors the log via SSE. The server is the source of
 * truth; high scores are re-derived on demand from the log rather than stored.
 *
 * Wire format: newest-first when returned by `GET /api/games`; SSE emits
 * `game.created` and `game.deleted` incrementally.
 */

import { derived, type Readable } from 'svelte/store'
import { printerLive, robustFetch } from '@src/lib/print/printerClient'

const BASE: string = import.meta.env.VITE_PRINTER_DAEMON_URL ?? ''
const API = `${BASE}/api/games`

/** Server-side enum; JSON is `snake_case`. */
export type GameEndReason = 'collision' | 'exited_germany'

/** One finished game as persisted by the server. */
export interface GameRecord {
  id: string
  tsMs: number
  stateId: string
  reason: GameEndReason
  score: number
  durationMs: number
  escapeHeadingRad?: number
  wasOverallHigh: boolean
  wasStateHigh: boolean
}

/** Payload for `POST /api/games`. Server fills in id / tsMs / was*High. */
export interface NewGame {
  stateId: string
  reason: GameEndReason
  score: number
  durationMs: number
  escapeHeadingRad?: number
}

/** Computed high scores. Server re-derives from the log on every call. */
export interface HighScores {
  overall: number
  byState: Record<string, number>
}

async function jsonOrThrow<T>(res: Response): Promise<T> {
  if (!res.ok) {
    throw new Error(`game-log request failed: ${res.status} ${res.statusText}`)
  }
  return (await res.json()) as T
}

export interface GamesListOptions {
  limit?: number
  offset?: number
}

export async function fetchGames(
  opts: GamesListOptions = {},
): Promise<GameRecord[]> {
  const params = new URLSearchParams()
  if (opts.limit !== undefined) params.set('limit', String(opts.limit))
  if (opts.offset !== undefined) params.set('offset', String(opts.offset))
  const qs = params.toString()
  return jsonOrThrow(await robustFetch(qs ? `${API}?${qs}` : API))
}

export async function recordGame(game: NewGame): Promise<GameRecord> {
  return jsonOrThrow(
    await robustFetch(API, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(game),
    }),
  )
}

export async function deleteGame(id: string): Promise<void> {
  const res = await robustFetch(`${API}/${encodeURIComponent(id)}`, {
    method: 'DELETE',
  })
  if (!res.ok && res.status !== 404) {
    throw new Error(`deleteGame failed: ${res.status}`)
  }
}

export async function fetchHighScores(): Promise<HighScores> {
  return jsonOrThrow(await robustFetch(`${API}/high-scores`))
}

/** Wipe the entire game log. Attendant-only; returns the number cleared. */
export async function clearGames(): Promise<{ cleared: number }> {
  const res = await robustFetch(API, { method: 'DELETE' })
  if (!res.ok) throw new Error(`clearGames failed: ${res.status}`)
  return (await res.json()) as { cleared: number }
}

// ---------------------------------------------------------------------------
// Live store — projection of `printerLive` for game-log consumers.
// ---------------------------------------------------------------------------

export interface GamesLiveState {
  games: GameRecord[]
  connected: boolean
}

/**
 * Live game log, newest-first. Derives from `printerLive` so all SSE traffic
 * flows through a single `EventSource`. This eliminates dual-connection
 * starvation on the Vite proxy (SSE gets funny when there are two long-lived
 * streams to the same URL) and keeps the store's `connected` flag in lockstep
 * with the printer/queue view. Same public API as before.
 */
export const gamesLive: Readable<GamesLiveState> = derived(
  printerLive,
  ($p) => ({ games: $p.games, connected: $p.connection === 'online' }),
)
