import { afterEach, describe, expect, it, vi } from 'vitest'
import type { Engine } from '@src/stargazer'
import { enterpriseEngine, whenEngine } from './engineHandle'

const engine = { id: 'engine' } as unknown as Engine

describe('whenEngine', () => {
  afterEach(() => {
    enterpriseEngine.set(null)
    vi.useRealTimers()
  })

  it('resolves at once with the running engine', async () => {
    enterpriseEngine.set(engine)
    await expect(whenEngine()).resolves.toBe(engine)
  })

  it('waits for an engine to start', async () => {
    const pending = whenEngine()
    enterpriseEngine.set(engine)
    await expect(pending).resolves.toBe(engine)
  })

  it('gives up when no engine starts in time', async () => {
    vi.useFakeTimers()
    const pending = whenEngine(500)
    vi.advanceTimersByTime(500)
    await expect(pending).rejects.toThrow('no enterprise engine')
  })
})
