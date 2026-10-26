import { describe, expect, it } from 'vitest'
import {
  OUTBOX_MAX_AGE_MS,
  enqueueSubmission,
  flushSubmissions,
  pendingSubmissions,
  type OutboxStorage,
} from './outbox'

function memoryStore(): OutboxStorage {
  const map = new Map<string, string>()
  return {
    getItem: (k) => map.get(k) ?? null,
    setItem: (k, v) => void map.set(k, v),
  }
}

const entry = {
  display: 'enterprise-eu',
  name: 'mia',
  score: 12,
  region: 'DEU',
}

describe('leaderboard outbox', () => {
  it('keeps a queued submission until it is sent', async () => {
    const store = memoryStore()
    enqueueSubmission(entry, 1000, store)
    expect(pendingSubmissions(store)).toBe(1)
    const sent: string[] = []
    await flushSubmissions(
      async (e) => {
        sent.push(e.name)
      },
      2000,
      store,
    )
    expect(sent).toEqual(['mia'])
    expect(pendingSubmissions(store)).toBe(0)
  })

  it('keeps a submission that fails again', async () => {
    const store = memoryStore()
    enqueueSubmission(entry, 1000, store)
    await flushSubmissions(
      () => Promise.reject(new Error('offline')),
      2000,
      store,
    )
    expect(pendingSubmissions(store)).toBe(1)
  })

  it('drops a submission older than a day without sending it', async () => {
    const store = memoryStore()
    enqueueSubmission(entry, 0, store)
    let sends = 0
    await flushSubmissions(
      async () => {
        sends++
      },
      OUTBOX_MAX_AGE_MS + 1,
      store,
    )
    expect(sends).toBe(0)
    expect(pendingSubmissions(store)).toBe(0)
  })

  it('survives a corrupt store', async () => {
    const store = memoryStore()
    store.setItem('barnguard.leaderboard.outbox', '{not json')
    expect(pendingSubmissions(store)).toBe(0)
    enqueueSubmission(entry, 1, store)
    expect(pendingSubmissions(store)).toBe(1)
  })

  it('does nothing without storage', async () => {
    enqueueSubmission(entry, 1, null)
    await flushSubmissions(async () => {}, 1, null)
    expect(pendingSubmissions(null)).toBe(0)
  })
})
