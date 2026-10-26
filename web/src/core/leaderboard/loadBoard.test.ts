import { beforeEach, describe, expect, it, vi } from 'vitest'
import { writable } from 'svelte/store'
import type { ConnectionState } from '@src/core/print/printerClient'
import type { LeaderboardEntry } from './leaderboardClient'

const connection = writable<{ connection: ConnectionState }>({
  connection: 'offline',
})
const fetchLeaderboard = vi.fn<() => Promise<LeaderboardEntry[]>>()
const flushSubmissions = vi.fn(() => Promise.resolve())

vi.mock('@src/core/print/printerClient', () => ({ printerLive: connection }))
vi.mock('./leaderboardClient', () => ({
  fetchLeaderboard: () => fetchLeaderboard(),
}))
vi.mock('./outbox', () => ({ flushSubmissions: () => flushSubmissions() }))

const { loadBoard } = await import('./loadBoard')

/** Let the promise chain run to the end. */
const settle = (): Promise<void> => new Promise((r) => setTimeout(r, 0))

describe('loadBoard', () => {
  beforeEach(() => {
    connection.set({ connection: 'offline' })
    fetchLeaderboard.mockReset()
    flushSubmissions.mockClear()
  })

  it('loads the board and sends queued submissions first', async () => {
    fetchLeaderboard.mockResolvedValueOnce([])
    const onLoaded = vi.fn()
    loadBoard('enterprise-eu', 50, onLoaded, vi.fn())
    await settle()
    expect(flushSubmissions).toHaveBeenCalledTimes(1)
    expect(onLoaded).toHaveBeenCalledWith([])
  })

  it('fetches again when the backend comes back online', async () => {
    fetchLeaderboard.mockRejectedValueOnce(new Error('down'))
    const onLoaded = vi.fn()
    const onUnavailable = vi.fn()
    loadBoard('enterprise-eu', 50, onLoaded, onUnavailable)
    await settle()
    expect(onUnavailable).toHaveBeenCalledTimes(1)

    fetchLeaderboard.mockResolvedValueOnce([])
    connection.set({ connection: 'connecting' })
    connection.set({ connection: 'online' })
    await settle()
    expect(onLoaded).toHaveBeenCalledTimes(1)
    expect(flushSubmissions).toHaveBeenCalledTimes(2)
  })

  it('keeps waiting through a retry that fails too', async () => {
    fetchLeaderboard.mockRejectedValue(new Error('down'))
    const onLoaded = vi.fn()
    loadBoard('enterprise-eu', 50, onLoaded, vi.fn())
    await settle()
    connection.set({ connection: 'online' })
    await settle()
    expect(onLoaded).not.toHaveBeenCalled()

    fetchLeaderboard.mockResolvedValueOnce([])
    connection.set({ connection: 'offline' })
    connection.set({ connection: 'online' })
    await settle()
    expect(onLoaded).toHaveBeenCalledTimes(1)
  })

  it('does nothing more once stopped', async () => {
    fetchLeaderboard.mockRejectedValueOnce(new Error('down'))
    const onLoaded = vi.fn()
    const stop = loadBoard('enterprise-eu', 50, onLoaded, vi.fn())
    await settle()
    stop()
    fetchLeaderboard.mockResolvedValueOnce([])
    connection.set({ connection: 'online' })
    await settle()
    expect(fetchLeaderboard).toHaveBeenCalledTimes(1)
    expect(onLoaded).not.toHaveBeenCalled()
  })

  it('drops a result that lands after it is stopped', async () => {
    let resolve: (list: LeaderboardEntry[]) => void = () => {}
    fetchLeaderboard.mockReturnValueOnce(
      new Promise((r) => {
        resolve = r
      }),
    )
    const onLoaded = vi.fn()
    const stop = loadBoard('enterprise-eu', 50, onLoaded, vi.fn())
    await settle()
    stop()
    resolve([])
    await settle()
    expect(onLoaded).not.toHaveBeenCalled()
  })
})
