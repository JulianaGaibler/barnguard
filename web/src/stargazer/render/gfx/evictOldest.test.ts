import { describe, expect, it } from 'vitest'
import { evictOldest } from './evictOldest'

describe('evictOldest', () => {
  it('evicts in least-recently-used order when hits re-set their key', () => {
    const m = new Map([
      ['a', 1],
      ['b', 2],
      ['c', 3],
    ])
    expect(evictOldest(m)).toEqual(['a', 1])
    // A hit on `b` moves it behind `c`.
    m.delete('b')
    m.set('b', 2)
    m.set('d', 4)
    expect(evictOldest(m)?.[0]).toBe('c')
    expect(evictOldest(m)?.[0]).toBe('b')
    expect(evictOldest(m)?.[0]).toBe('d')
    expect(evictOldest(m)).toBeUndefined()
    // Entries added after the map ran empty are still found.
    m.set('e', 5)
    expect(evictOldest(m)).toEqual(['e', 5])
  })
})
