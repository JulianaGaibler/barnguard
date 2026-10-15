/**
 * Leaderboard submissions that could not reach the server, kept in
 * `localStorage` and sent again later, so a name typed while the server was
 * down is not lost.
 *
 * An entry older than {@link OUTBOX_MAX_AGE_MS} is dropped rather than sent: a
 * score from yesterday's event landing on today's board would be wrong.
 */
import { submitScore } from './leaderboardClient'

export const OUTBOX_KEY = 'barnguard.leaderboard.outbox'
export const OUTBOX_MAX_AGE_MS = 24 * 60 * 60 * 1000
/** The outbox never grows past this, the oldest entries go first. */
const OUTBOX_MAX_ENTRIES = 50

export interface OutboxEntry {
  display: string
  name: string
  score: number
  region?: string
  /** When the entry was queued, `Date.now()`. */
  queuedAt: number
}

/** Storage the outbox reads and writes, replaceable in tests. */
export interface OutboxStorage {
  getItem(key: string): string | null
  setItem(key: string, value: string): void
}

function storage(): OutboxStorage | null {
  try {
    return typeof localStorage === 'undefined' ? null : localStorage
  } catch {
    return null
  }
}

function read(store: OutboxStorage): OutboxEntry[] {
  try {
    const parsed: unknown = JSON.parse(store.getItem(OUTBOX_KEY) ?? '[]')
    return Array.isArray(parsed) ? (parsed as OutboxEntry[]) : []
  } catch {
    return []
  }
}

function write(store: OutboxStorage, entries: OutboxEntry[]): void {
  try {
    store.setItem(OUTBOX_KEY, JSON.stringify(entries))
  } catch {
    // A full or blocked store only means the entry is not kept.
  }
}

/** Queue a submission to send later. */
export function enqueueSubmission(
  entry: Omit<OutboxEntry, 'queuedAt'>,
  now: number = Date.now(),
  store: OutboxStorage | null = storage(),
): void {
  if (!store) return
  const entries = read(store)
  entries.push({ ...entry, queuedAt: now })
  write(store, entries.slice(-OUTBOX_MAX_ENTRIES))
}

/**
 * Send every queued submission that is still fresh. Sent ones and stale ones
 * leave the outbox, failed ones stay for the next try. Never rejects.
 */
export async function flushSubmissions(
  send: (entry: OutboxEntry) => Promise<unknown> = (e) =>
    submitScore(e.display, e.name, e.score, e.region),
  now: number = Date.now(),
  store: OutboxStorage | null = storage(),
): Promise<void> {
  if (!store) return
  const fresh = read(store).filter((e) => now - e.queuedAt < OUTBOX_MAX_AGE_MS)
  const kept: OutboxEntry[] = []
  for (const entry of fresh) {
    try {
      await send(entry)
    } catch {
      kept.push(entry)
    }
  }
  write(store, kept)
}

/** How many submissions are waiting, for a test or a status line. */
export function pendingSubmissions(
  store: OutboxStorage | null = storage(),
): number {
  return store ? read(store).length : 0
}
