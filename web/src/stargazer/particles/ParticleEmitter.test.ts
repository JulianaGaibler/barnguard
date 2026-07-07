import { describe, expect, it } from 'vitest'
import { ParticleEmitter } from './ParticleEmitter'

const BASE_CONFIG = {
  capacity: 20,
  ratePerSec: 0,
  lifetimeSec: [1, 1] as const,
  speedWorld: [100, 100] as const,
  spreadRad: 0,
  emitDirectionRad: 0, // aim +x
  sizeWorld: [10, 10] as const,
  palette: ['#ffffff'],
}

describe('ParticleEmitter', () => {
  it('burst emits the requested count (bounded by capacity)', () => {
    const e = new ParticleEmitter({ ...BASE_CONFIG, capacity: 5 })
    e.burst(10, 0, 0)
    expect(e.aliveCount).toBe(5)
  })

  it('particles advance along their initial velocity', () => {
    const e = new ParticleEmitter({ ...BASE_CONFIG })
    e.burst(1, 0, 0) // spreadRad=0, dir=0 → vx=100, vy=0
    const f = e.pool.field
    // Find the alive slot (spawn returns first free, likely 0).
    let idx = -1
    for (let i = 0; i < e.pool.capacity; i++) {
      if (f.alive[i] === 1) {
        idx = i
        break
      }
    }
    expect(idx).toBeGreaterThanOrEqual(0)
    expect(f.x[idx]).toBe(0)
    e.update(0.5)
    // 100 world/s * 0.5s = 50
    expect(f.x[idx]).toBeCloseTo(50, 5)
    expect(f.y[idx]).toBeCloseTo(0, 5)
  })

  it('damping reduces velocity exponentially', () => {
    const e = new ParticleEmitter({
      ...BASE_CONFIG,
      lifetimeSec: [10, 10], // long-lived so we can measure damping across ticks
      dampingPerSec: Math.log(4),
    })
    // With `dampingPerSec = ln(4)`, each second scales v by exp(-ln4) = 1/4.
    e.burst(1, 0, 0)
    const f = e.pool.field
    const idx = firstAlive(e)
    expect(f.vx[idx]).toBeCloseTo(100, 5)
    e.update(1)
    expect(f.vx[idx]).toBeCloseTo(100 / 4, 3)
    e.update(1)
    expect(f.vx[idx]).toBeCloseTo(100 / 16, 3)
  })

  it('acceleration adds to velocity linearly', () => {
    const e = new ParticleEmitter({
      ...BASE_CONFIG,
      accelerationWorld: { x: 0, y: 200 },
    })
    e.burst(1, 0, 0)
    const f = e.pool.field
    const idx = firstAlive(e)
    e.update(0.5)
    // vy: 0 + 200 * 0.5 = 100. But also position updated with the new vy
    // (order in code: damp → accel → integrate). So vy after update = 100.
    expect(f.vy[idx]).toBeCloseTo(100, 5)
  })

  it('kills particles when life runs out', () => {
    const e = new ParticleEmitter({ ...BASE_CONFIG, lifetimeSec: [0.5, 0.5] })
    e.burst(3, 0, 0)
    expect(e.aliveCount).toBe(3)
    e.update(0.5) // life -= 0.5 → 0, killed
    expect(e.aliveCount).toBe(0)
  })

  it('ratePerSec accumulator emits at the correct steady-state rate', () => {
    const e = new ParticleEmitter({
      ...BASE_CONFIG,
      capacity: 200,
      ratePerSec: 100,
      lifetimeSec: [10, 10],
    })
    e.setOrigin(0, 0)
    // 100/sec for 1 second = 100 particles.
    e.update(1)
    expect(e.aliveCount).toBe(100)
  })

  it('clear removes every live particle', () => {
    const e = new ParticleEmitter({ ...BASE_CONFIG })
    e.burst(5, 0, 0)
    expect(e.aliveCount).toBe(5)
    e.clear()
    expect(e.aliveCount).toBe(0)
  })
})

function firstAlive(e: ParticleEmitter): number {
  for (let i = 0; i < e.pool.capacity; i++) {
    if (e.pool.field.alive[i] === 1) return i
  }
  throw new Error('no alive particle')
}
