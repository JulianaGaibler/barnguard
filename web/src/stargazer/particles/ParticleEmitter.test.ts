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

  it('spin integrates angle over time, sampled from the configured range', () => {
    const e = new ParticleEmitter({
      ...BASE_CONFIG,
      lifetimeSec: [10, 10], // long-lived so it survives both updates below
      spinRadPerSec: [2, 2],
    })
    e.burst(1, 0, 0)
    const f = e.pool.field
    const idx = firstAlive(e)
    expect(f.spin[idx]).toBeCloseTo(2, 5)
    expect(f.angle[idx]).toBe(0)
    e.update(1)
    expect(f.angle[idx]).toBeCloseTo(2, 5)
    e.update(1)
    expect(f.angle[idx]).toBeCloseTo(4, 5)
  })

  it('spin range samples within its bounds, sign included when it straddles zero', () => {
    const e = new ParticleEmitter({
      ...BASE_CONFIG,
      capacity: 100,
      spinRadPerSec: [-5, 5],
    })
    e.burst(100, 0, 0)
    const f = e.pool.field
    let min = Infinity
    let max = -Infinity
    for (let i = 0; i < e.pool.capacity; i++) {
      if (f.alive[i] === 0) continue
      min = Math.min(min, f.spin[i])
      max = Math.max(max, f.spin[i])
    }
    expect(min).toBeGreaterThanOrEqual(-5)
    expect(max).toBeLessThanOrEqual(5)
    expect(min).toBeLessThan(0)
    expect(max).toBeGreaterThan(0)
  })

  it('minSpeedFrac kills a particle once its speed ratio decays below the threshold, independent of remaining life', () => {
    const e = new ParticleEmitter({
      ...BASE_CONFIG,
      lifetimeSec: [100, 100], // long-lived so life alone wouldn't kill it
      dampingPerSec: Math.log(4), // v halves-then-some each second, see above
      minSpeedFrac: 0.5,
    })
    e.burst(1, 0, 0) // speed0 = 100
    expect(e.aliveCount).toBe(1)
    e.update(1) // v = 100/4 = 25 < 0.5*100 -> killed
    expect(e.aliveCount).toBe(0)
  })

  it('speed0 is recorded at spawn for scaleBy/minSpeedFrac to read', () => {
    const e = new ParticleEmitter({ ...BASE_CONFIG, speedWorld: [42, 42] })
    e.burst(1, 0, 0)
    const idx = firstAlive(e)
    expect(e.pool.field.speed0[idx]).toBeCloseTo(42, 5)
  })

  it('waitUntilEmpty resolves immediately when already empty at call time', async () => {
    const e = new ParticleEmitter({ ...BASE_CONFIG })
    let resolved = false
    void e.waitUntilEmpty().then(() => {
      resolved = true
    })
    await Promise.resolve()
    expect(resolved).toBe(true)
  })

  it('waitUntilEmpty stays pending until the burst it tracks fully drains', async () => {
    const e = new ParticleEmitter({ ...BASE_CONFIG, lifetimeSec: [1, 1] })
    e.burst(3, 0, 0)
    let resolved = false
    void e.waitUntilEmpty().then(() => {
      resolved = true
    })
    await Promise.resolve()
    expect(resolved).toBe(false)
    e.update(0.5)
    await Promise.resolve()
    expect(resolved).toBe(false)
    expect(e.aliveCount).toBe(3)
    e.update(0.5) // life hits 0 for all three
    expect(e.aliveCount).toBe(0)
    await Promise.resolve()
    expect(resolved).toBe(true)
  })

  it('waitUntilEmpty on a reused emitter tracks a SECOND burst with no manual reset', async () => {
    // No persistent "ever spawned" flag to reset between cycles: calling
    // `burst()` then `waitUntilEmpty()` again, in that order, just works.
    const e = new ParticleEmitter({ ...BASE_CONFIG, lifetimeSec: [1, 1] })
    e.burst(1, 0, 0)
    e.update(1) // first cycle fully drains
    expect(e.aliveCount).toBe(0)

    // Second cycle: burst again, then wait, in the same synchronous span
    // (the documented contract — aliveCount is 1 here, not 0, so there's no
    // stale state to misread regardless of history).
    e.burst(1, 0, 0)
    let resolved = false
    void e.waitUntilEmpty().then(() => {
      resolved = true
    })
    await Promise.resolve()
    expect(resolved).toBe(false)
    e.update(1)
    await Promise.resolve()
    expect(resolved).toBe(true)
  })

  it('clear() drains any pending waitUntilEmpty resolver', async () => {
    const e = new ParticleEmitter({ ...BASE_CONFIG, lifetimeSec: [100, 100] })
    e.burst(3, 0, 0)
    let resolved = false
    void e.waitUntilEmpty().then(() => {
      resolved = true
    })
    await Promise.resolve()
    expect(resolved).toBe(false)
    e.clear()
    await Promise.resolve()
    expect(resolved).toBe(true)
  })
})

function firstAlive(e: ParticleEmitter): number {
  for (let i = 0; i < e.pool.capacity; i++) {
    if (e.pool.field.alive[i] === 1) return i
  }
  throw new Error('no alive particle')
}
