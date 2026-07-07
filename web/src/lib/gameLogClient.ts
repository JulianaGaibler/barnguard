/**
 * Typed client for the server-side game log (`/api/games`), including a Svelte
 * store (`gamesLive`) that mirrors the log via SSE. The server is the source of
 * truth; high scores are re-derived on demand from the log rather than stored.
 *
 * Wire format: newest-first when returned by `GET /api/games`; SSE emits
 * `game.created` and `game.deleted` incrementally.
 */

import { readable, type Readable } from 'svelte/store'

const BASE: string = import.meta.env.VITE_PRINTER_DAEMON_URL ?? ''
const API = `${BASE}/api/games`
const SSE_URL = `${BASE}/api/printer/events`

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
  return jsonOrThrow(await fetch(qs ? `${API}?${qs}` : API))
}

export async function recordGame(game: NewGame): Promise<GameRecord> {
  return jsonOrThrow(
    await fetch(API, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(game),
    }),
  )
}

export async function deleteGame(id: string): Promise<void> {
  const res = await fetch(`${API}/${encodeURIComponent(id)}`, {
    method: 'DELETE',
  })
  if (!res.ok && res.status !== 404) {
    throw new Error(`deleteGame failed: ${res.status}`)
  }
}

export async function fetchHighScores(): Promise<HighScores> {
  return jsonOrThrow(await fetch(`${API}/high-scores`))
}

/** Wipe the entire game log. Attendant-only; returns the number cleared. */
export async function clearGames(): Promise<{ cleared: number }> {
  const res = await fetch(API, { method: 'DELETE' })
  if (!res.ok) throw new Error(`clearGames failed: ${res.status}`)
  return (await res.json()) as { cleared: number }
}

// ---------------------------------------------------------------------------
// Live store — SSE-driven mirror of the game log, newest-first.
// ---------------------------------------------------------------------------

export interface GamesLiveState {
  games: GameRecord[]
  connected: boolean
}

const EMPTY_LIVE: GamesLiveState = { games: [], connected: false }

/**
 * Live game log over SSE, sorted newest-first. The server backfills the current
 * list on connect via a `games` event, then pushes `game.created` /
 * `game.deleted` incrementally. This store opens its own `EventSource` (same
 * origin as `printerLive`; HTTP/2 multiplexes, no extra TCP cost) so its state
 * stays cleanly separated from the printer/queue store.
 */
export const gamesLive: Readable<GamesLiveState> = readable<GamesLiveState>(
  EMPTY_LIVE,
  (set) => {
    if (typeof EventSource === 'undefined') return () => {}

    let state = EMPTY_LIVE
    const update = (patch: Partial<GamesLiveState>): void => {
      state = { ...state, ...patch }
      set(state)
    }

    const es = new EventSource(SSE_URL)

    // Backfill on connect: server pushes a `games` event with the current
    // snapshot (oldest → newest). We flip to newest-first for the store.
    es.addEventListener('games', (e) => {
      const list = JSON.parse(e.data) as GameRecord[]
      update({ games: [...list].reverse(), connected: true })
    })
    es.addEventListener('game.created', (e) => {
      const rec = JSON.parse(e.data) as GameRecord
      // Guard against dupes if the record already landed via backfill.
      if (state.games.some((g) => g.id === rec.id)) return
      update({ games: [rec, ...state.games] })
    })
    es.addEventListener('game.deleted', (e) => {
      const id = String(e.data ?? '').trim()
      if (!id) return
      update({ games: state.games.filter((g) => g.id !== id) })
    })
    es.onopen = () => update({ connected: true })
    es.onerror = () => update({ connected: false })

    return () => es.close()
  },
)
