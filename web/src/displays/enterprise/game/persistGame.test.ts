import { beforeEach, describe, expect, it, vi } from 'vitest'
import { writable } from 'svelte/store'
import type { ConnectionState } from '@src/core/print/printerClient'

const connection = writable<{ connection: ConnectionState }>({
  connection: 'online',
})
const recordEnterpriseGame = vi.fn()
const fetchEnterpriseHighScores = vi.fn()

vi.mock('@src/core/print/printerClient', () => ({ printerLive: connection }))
vi.mock('../game-log', () => ({
  recordEnterpriseGame: () => recordEnterpriseGame(),
  fetchEnterpriseHighScores: () => fetchEnterpriseHighScores(),
}))

const { persistFinishedGame } = await import('./persistGame')

const INPUT = {
  mapId: 'eu',
  stateId: 'DEU',
  reason: 'collision' as const,
  score: 12,
  durationMs: 30_000,
}
const RECORD = { id: 'g1', wasOverallHigh: true, wasStateHigh: false }
const HIGH = { overall: 12 }

/** Let the promise chain run to the end. */
const settle = (): Promise<void> => new Promise((r) => setTimeout(r, 0))

/** The backend drops and returns, as after a server restart. */
function reconnect(): void {
  connection.set({ connection: 'offline' })
  connection.set({ connection: 'online' })
}

describe('persistFinishedGame', () => {
  beforeEach(() => {
    vi.spyOn(console, 'warn').mockImplementation(() => {})
    connection.set({ connection: 'online' })
    recordEnterpriseGame.mockReset()
    fetchEnterpriseHighScores.mockReset()
  })

  it('records the game and fetches the high scores', async () => {
    recordEnterpriseGame.mockResolvedValue(RECORD)
    fetchEnterpriseHighScores.mockResolvedValue(HIGH)
    const onDone = vi.fn()
    persistFinishedGame(INPUT, onDone)
    await settle()
    expect(onDone).toHaveBeenCalledWith({ record: RECORD, highScores: HIGH })
  })

  it('records the game once the backend is back', async () => {
    recordEnterpriseGame.mockRejectedValueOnce(new Error('down'))
    const onDone = vi.fn()
    persistFinishedGame(INPUT, onDone)
    await settle()
    expect(onDone).not.toHaveBeenCalled()

    recordEnterpriseGame.mockResolvedValue(RECORD)
    fetchEnterpriseHighScores.mockResolvedValue(HIGH)
    reconnect()
    await settle()
    expect(onDone).toHaveBeenCalledTimes(1)
  })

  it('does not record the game twice when only the high scores failed', async () => {
    recordEnterpriseGame.mockResolvedValue(RECORD)
    fetchEnterpriseHighScores.mockRejectedValueOnce(new Error('down'))
    const onDone = vi.fn()
    persistFinishedGame(INPUT, onDone)
    await settle()

    fetchEnterpriseHighScores.mockResolvedValue(HIGH)
    reconnect()
    await settle()
    expect(recordEnterpriseGame).toHaveBeenCalledTimes(1)
    expect(onDone).toHaveBeenCalledWith({ record: RECORD, highScores: HIGH })
  })

  it('stops retrying once it has landed', async () => {
    recordEnterpriseGame.mockRejectedValueOnce(new Error('down'))
    recordEnterpriseGame.mockResolvedValue(RECORD)
    fetchEnterpriseHighScores.mockResolvedValue(HIGH)
    const onDone = vi.fn()
    persistFinishedGame(INPUT, onDone)
    await settle()
    reconnect()
    await settle()
    reconnect()
    await settle()
    expect(recordEnterpriseGame).toHaveBeenCalledTimes(2)
    expect(onDone).toHaveBeenCalledTimes(1)
  })
})
