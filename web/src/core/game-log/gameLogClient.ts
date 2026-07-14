/**
 * Typed client for the server-side game log (`/api/games`), plus a Svelte
 * store (`gamesLive`) that mirrors the log via SSE. The server is the source
 * of truth; high scores are re-derived on demand from the log rather than
 * stored.
 *
 * Wire format: newest-first when returned by `GET /api/games`; SSE emits
 * `game.created` and `game.deleted` incrementally. Every record carries a
 * `display` discriminator that lines up with the URL `?display=<id>` param.
 *
 * Type stance: this module owns only the shared envelope. Display-specific
 * fields (whatever a display puts alongside its records) come through as an
 * open record; a display's own `game-log.ts` module re-exports strongly-typed
 * wrappers scoped to its `display` id.
 */

import { derived, type Readable } from 'svelte/store'
import { printerLive, robustFetch } from '@src/core/print/printerClient'

const BASE: string = import.meta.env.VITE_PRINTER_DAEMON_URL ?? ''
const API = `${BASE}/api/games`

// ---------------------------------------------------------------------------
// Envelope — everything the core knows about a record.
// ---------------------------------------------------------------------------

/** Shared fields every persisted game carries, regardless of display. */
export interface GameRecordEnvelope {
  id: string
  tsMs: number
  score: number
  durationMs: number
  display: string
}

/**
 * Runtime shape of a `GameRecord`: envelope plus an open record for the
 * display-specific fields flattened next to it on the wire. A display module
 * casts this to its own strong type where it consumes the fields.
 */
export type GameRecord = GameRecordEnvelope & Record<string, unknown>

/** Payload for `POST /api/games`. Server fills in id/tsMs and any high-score flags. */
export interface NewGameEnvelope {
  score: number
  durationMs: number
  display: string
}
export type NewGame = NewGameEnvelope & Record<string, unknown>

/**
 * Envelope for per-display high-score responses. Concrete shape (e.g.
 * `{ overall, byState }`) is defined by each display's own game-log module.
 */
export interface HighScoresEnvelope {
  display: string
}
export type HighScores = HighScoresEnvelope & Record<string, unknown>

// ---------------------------------------------------------------------------
// Fetch helpers
// ---------------------------------------------------------------------------

async function jsonOrThrow<T>(res: Response): Promise<T> {
  if (!res.ok) {
    throw new Error(`game-log request failed: ${res.status} ${res.statusText}`)
  }
  return (await res.json()) as T
}

export interface GamesListOptions {
  limit?: number
  offset?: number
  display?: string
}

export async function fetchGames(
  opts: GamesListOptions = {},
): Promise<GameRecord[]> {
  const params = new URLSearchParams()
  if (opts.limit !== undefined) params.set('limit', String(opts.limit))
  if (opts.offset !== undefined) params.set('offset', String(opts.offset))
  if (opts.display !== undefined) params.set('display', opts.display)
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

export async function fetchHighScores(display: string): Promise<HighScores> {
  const params = new URLSearchParams({ display })
  return jsonOrThrow(
    await robustFetch(`${API}/high-scores?${params.toString()}`),
  )
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
 * flows through a single `EventSource`. Same public API as before.
 */
export const gamesLive: Readable<GamesLiveState> = derived(
  printerLive,
  ($p) => ({ games: $p.games, connected: $p.connection === 'online' }),
)
