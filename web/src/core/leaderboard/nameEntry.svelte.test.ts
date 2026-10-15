import { beforeEach, describe, expect, it, vi } from 'vitest'
import { writable } from 'svelte/store'
import type { ConnectionState } from '@src/core/print/printerClient'
import type { LeaderboardEntry } from './leaderboardClient'

const connection = writable<{ connection: ConnectionState }>({
  connection: 'online',
})
const fetchLeaderboard = vi.fn<() => Promise<LeaderboardEntry[]>>()
const submitScore = vi.fn(() => Promise.resolve())

vi.mock('@src/core/print/printerClient', () => ({ printerLive: connection }))
vi.mock('./leaderboardClient', () => ({
  fetchLeaderboard: () => fetchLeaderboard(),
  submitScore: (...args: unknown[]) => submitScore(...(args as [])),
}))
vi.mock('./outbox', () => ({
  enqueueSubmission: vi.fn(),
  flushSubmissions: () => Promise.resolve(),
}))

const { NameEntry } = await import('./nameEntry.svelte')

/** Let the entry's promise chain run to the end. */
const settle = (): Promise<void> => new Promise((r) => setTimeout(r, 0))

describe('NameEntry', () => {
  beforeEach(() => {
    connection.set({ connection: 'online' })
    fetchLeaderboard.mockReset()
    submitScore.mockClear()
  })

  it('opens for a score that earns a row', async () => {
    fetchLeaderboard.mockResolvedValue([])
    const entry = new NameEntry({ display: 'enterprise-eu', score: 10 })
    expect(entry.stage).toBe('loading')
    entry.start()
    await settle()
    expect(entry.stage).toBe('entering')
  })

  it('closes for a score of nothing, with the board loaded', async () => {
    fetchLeaderboard.mockResolvedValue([{ name: 'ada', score: 5 } as never])
    const entry = new NameEntry({ display: 'enterprise-eu', score: 0 })
    entry.start()
    await settle()
    expect(entry.stage).toBe('closed')
    expect(entry.entries).toHaveLength(1)
  })

  it('shows the board unavailable while the backend is down', async () => {
    fetchLeaderboard.mockRejectedValue(new Error('down'))
    const entry = new NameEntry({ display: 'enterprise-eu', score: 10 })
    entry.start()
    await settle()
    expect(entry.stage).toBe('unavailable')
    // Leaving the screen saves the entry, which stops it waiting on the
    // connection. Without it the next test would share its subscription.
    await entry.save()
  })

  it('opens the name row when the backend comes back', async () => {
    connection.set({ connection: 'offline' })
    fetchLeaderboard.mockRejectedValueOnce(new Error('down'))
    const entry = new NameEntry({ display: 'enterprise-eu', score: 10 })
    entry.start()
    await settle()
    expect(entry.stage).toBe('unavailable')

    fetchLeaderboard.mockResolvedValueOnce([])
    connection.set({ connection: 'connecting' })
    connection.set({ connection: 'online' })
    await settle()
    expect(entry.stage).toBe('entering')
  })

  it('stops waiting once the entry is saved', async () => {
    connection.set({ connection: 'offline' })
    fetchLeaderboard.mockRejectedValueOnce(new Error('down'))
    const entry = new NameEntry({ display: 'enterprise-eu', score: 10 })
    entry.start()
    await settle()
    await entry.save()
    fetchLeaderboard.mockResolvedValue([])
    connection.set({ connection: 'online' })
    await settle()
    expect(entry.stage).toBe('unavailable')
    expect(submitScore).not.toHaveBeenCalled()
  })

  it('submits a typed name once, however it is saved', async () => {
    fetchLeaderboard.mockResolvedValue([])
    const entry = new NameEntry({ display: 'enterprise-eu', score: 10 })
    entry.start()
    await settle()
    entry.name = 'ada'
    await entry.save()
    await entry.save()
    expect(submitScore).toHaveBeenCalledTimes(1)
  })
})
