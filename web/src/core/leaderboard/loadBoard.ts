import { printerLive } from '@src/core/print/printerClient'
import { fetchLeaderboard, type LeaderboardEntry } from './leaderboardClient'
import { flushSubmissions } from './outbox'
import { onReconnect } from '@src/core/print/reconnect'

/**
 * Fetch a board for a game-over screen, sending any queued submissions first so
 * the board already includes them.
 *
 * A failed fetch calls `onUnavailable`, then fetches again each time the
 * backend connection comes back online, so a server restart at the booth still
 * gets the board onto a screen that is waiting for it. `onLoaded` runs once,
 * for the first fetch that succeeds. Returns the function that stops
 * everything; after it, neither callback runs.
 */
export function loadBoard(
  display: string,
  limit: number,
  onLoaded: (list: LeaderboardEntry[]) => void,
  onUnavailable: () => void,
): () => void {
  let stopped = false
  let loading = false
  let unwatch: (() => void) | null = null

  const stop = (): void => {
    stopped = true
    unwatch?.()
    unwatch = null
  }

  const load = (): void => {
    if (loading || stopped) return
    loading = true
    void flushSubmissions()
      .then(() => fetchLeaderboard(display, limit))
      .then((list) => {
        if (stopped) return
        stop()
        onLoaded(list)
      })
      .catch(() => {
        if (stopped) return
        onUnavailable()
        unwatch ??= onReconnect(printerLive, load)
      })
      .finally(() => {
        loading = false
      })
  }

  load()
  return stop
}
