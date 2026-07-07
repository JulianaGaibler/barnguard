import { describe, expect, it } from 'vitest'
import { ParticlePool } from './ParticlePool'

describe('ParticlePool', () => {
  it('rejects non-positive capacity', () => {
    expect(() => new ParticlePool(0)).toThrow()
    expect(() => new ParticlePool(-1)).toThrow()
  })

  it('starts with every slot on the freelist and none alive', () => {
    const p = new ParticlePool(10)
    expect(p.aliveCount).toBe(0)
    expect(p.availableCount).toBe(10)
    expect(p.highWaterIndex).toBe(0)
  })

  it('spawn returns unique indices and updates counts', () => {
    const p = new ParticlePool(4)
    const seen = new Set<number>()
    for (let i = 0; i < 4; i++) {
      const idx = p.spawn()
      expect(idx).toBeGreaterThanOrEqual(0)
      expect(seen.has(idx)).toBe(false)
      seen.add(idx)
    }
    expect(p.aliveCount).toBe(4)
    expect(p.availableCount).toBe(0)
    // Pool exhausted, next spawn returns -1.
    expect(p.spawn()).toBe(-1)
  })

  it('kill returns a slot to the freelist and updates counts', () => {
    const p = new ParticlePool(4)
    const a = p.spawn()
    const b = p.spawn()
    expect(p.aliveCount).toBe(2)
    p.kill(a)
    expect(p.aliveCount).toBe(1)
    expect(p.availableCount).toBe(3)
    // Re-spawn, should be able to fill up again.
    const c = p.spawn()
    expect(c).toBeGreaterThanOrEqual(0)
    expect(p.aliveCount).toBe(2)
    p.kill(b)
    p.kill(c)
    expect(p.aliveCount).toBe(0)
    expect(p.availableCount).toBe(4)
  })

  it('is a no-op to kill an already-dead slot', () => {
    const p = new ParticlePool(4)
    const a = p.spawn()
    p.kill(a)
    const availBefore = p.availableCount
    p.kill(a)
    p.kill(a)
    expect(p.availableCount).toBe(availBefore)
    expect(p.aliveCount).toBe(0)
  })

  it('freelist parity, every slot recovers after N spawn/kill cycles', () => {
    const capacity = 8
    const p = new ParticlePool(capacity)
    for (let cycle = 0; cycle < 200; cycle++) {
      const spawned: number[] = []
      const n = 1 + (cycle % capacity)
      for (let i = 0; i < n; i++) spawned.push(p.spawn())
      expect(p.aliveCount).toBe(n)
      for (const idx of spawned) p.kill(idx)
      expect(p.aliveCount).toBe(0)
      expect(p.availableCount).toBe(capacity)
    }
  })

  it('clear wipes alive slots and resets the freelist', () => {
    const p = new ParticlePool(4)
    for (let i = 0; i < 4; i++) p.spawn()
    expect(p.aliveCount).toBe(4)
    p.clear()
    expect(p.aliveCount).toBe(0)
    expect(p.availableCount).toBe(4)
    // Fresh spawns work again.
    const idx = p.spawn()
    expect(idx).toBeGreaterThanOrEqual(0)
    expect(p.aliveCount).toBe(1)
  })
})
