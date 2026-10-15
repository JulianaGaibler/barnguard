import { describe, expect, it } from 'vitest'
import { RetainedCache, type RetainedEntry } from './RetainedCache'

function make(budgetBytes = 1000, idleFrames = 3) {
  const released: string[] = []
  const cache = new RetainedCache<RetainedEntry>({
    name: 'test',
    idleFrames,
    budgetBytes,
  })
  const entry = (name: string, bytes: number): RetainedEntry => ({
    bytes,
    release: () => released.push(name),
  })
  return { cache, entry, released }
}

describe('RetainedCache', () => {
  it('admits a key on its second frame in a row', () => {
    const { cache } = make()
    const key = cache.keyFor({}, 'a')
    cache.sweep(1)
    expect(cache.admit(key)).toBe(false)
    cache.sweep(2)
    expect(cache.admit(key)).toBe(true)
  })

  it('does not admit a key that skipped a frame', () => {
    const { cache } = make()
    const key = cache.keyFor({}, 'a')
    cache.sweep(1)
    cache.admit(key)
    cache.sweep(3)
    expect(cache.admit(key)).toBe(false)
  })

  it('gives each source its own keys', () => {
    const { cache } = make()
    expect(cache.keyFor({}, 'a')).not.toBe(cache.keyFor({}, 'a'))
    const source = {}
    expect(cache.keyFor(source, 'a')).toBe(cache.keyFor(source, 'a'))
  })

  it('frees an entry left unused past its idle frames', () => {
    const { cache, entry, released } = make(1000, 3)
    cache.sweep(1)
    cache.add('k', entry('k', 10))
    cache.sweep(4)
    expect(cache.get('k')).not.toBeNull()
    cache.sweep(8)
    expect(cache.get('k')).toBeNull()
    expect(released).toEqual(['k'])
    expect(cache.stats.bytes).toBe(0)
  })

  it('frees the least recently used past the budget, never one in use', () => {
    const { cache, entry, released } = make(100, 1000)
    cache.sweep(1)
    cache.add('old', entry('old', 60))
    cache.sweep(2)
    cache.add('new', entry('new', 60))
    cache.sweep(3)
    expect(released).toEqual(['old'])
    expect(cache.stats.bytes).toBe(60)
  })

  it('keeps entries used in the frame before even past the budget', () => {
    const { cache, entry, released } = make(10, 1000)
    cache.sweep(1)
    cache.add('a', entry('a', 60))
    cache.sweep(2)
    expect(released).toEqual([])
  })

  it('frees the replaced entry when a key is added again', () => {
    const { cache, entry, released } = make()
    cache.add('k', entry('first', 10))
    cache.add('k', entry('second', 10))
    expect(released).toEqual(['first'])
    expect(cache.stats.entries).toBe(1)
  })

  it('clears with or without freeing', () => {
    const { cache, entry, released } = make()
    cache.add('a', entry('a', 10))
    cache.clear(false)
    expect(released).toEqual([])
    cache.add('b', entry('b', 10))
    cache.clear()
    expect(released).toEqual(['b'])
    expect(cache.stats.entries).toBe(0)
  })

  it('never grows when the key changes every frame', () => {
    const { cache, entry } = make()
    for (let frame = 1; frame < 50; frame++) {
      cache.sweep(frame)
      const key = cache.keyFor({}, String(frame))
      if (cache.admit(key)) cache.add(key, entry(key, 10))
    }
    expect(cache.stats.entries).toBe(0)
  })

  it('counts hits and admissions per frame', () => {
    const { cache, entry } = make()
    cache.sweep(1)
    cache.add('k', entry('k', 10))
    cache.get('k')
    expect(cache.stats).toMatchObject({ hits: 1, admitted: 1 })
    cache.sweep(2)
    expect(cache.stats).toMatchObject({ hits: 0, admitted: 0 })
  })
})
