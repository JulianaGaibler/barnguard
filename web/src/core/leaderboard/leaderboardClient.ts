/** Typed client for `/api/leaderboard`. `display` is a game's `GameMeta.id`. */
import { robustFetch } from '@src/core/print/printerClient'

const BASE: string = import.meta.env.VITE_PRINTER_DAEMON_URL ?? ''
const API = `${BASE}/api/leaderboard`

/** Requests past this are treated as failed. */
const TIMEOUT_MS = 2000

export interface LeaderboardEntry {
  id: string
  tsMs: number
  display: string
  /** Already server-normalized: lowercase, trimmed, max 6 characters. */
  name: string
  score: number
}

async function jsonOrThrow<T>(res: Response): Promise<T> {
  if (!res.ok) {
    throw new Error(
      `leaderboard request failed: ${res.status} ${res.statusText}`,
    )
  }
  return (await res.json()) as T
}

/** Best-first entries for `display`, capped to `limit` (default: all). */
export async function fetchLeaderboard(
  display: string,
  limit?: number,
): Promise<LeaderboardEntry[]> {
  const params = new URLSearchParams({ display })
  if (limit !== undefined) params.set('limit', String(limit))
  return jsonOrThrow(
    await robustFetch(`${API}?${params.toString()}`, {
      signal: AbortSignal.timeout(TIMEOUT_MS),
    }),
  )
}

/**
 * Submit a score for `name` under `display`; returns the stored record (the
 * server keeps the higher of the new and any prior score for that name).
 */
export async function submitScore(
  display: string,
  name: string,
  score: number,
): Promise<LeaderboardEntry> {
  return jsonOrThrow(
    await robustFetch(API, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ display, name, score }),
      signal: AbortSignal.timeout(TIMEOUT_MS),
    }),
  )
}

/** Attendant-only: remove a single entry by id. */
export async function deleteLeaderboardEntry(id: string): Promise<void> {
  const res = await robustFetch(`${API}/${encodeURIComponent(id)}`, {
    method: 'DELETE',
    signal: AbortSignal.timeout(TIMEOUT_MS),
  })
  if (!res.ok && res.status !== 404) {
    throw new Error(`deleteLeaderboardEntry failed: ${res.status}`)
  }
}
