import { describe, expect, it } from 'vitest'
import {
  createCountdown,
  EXTENSION_SECONDS,
  extend,
  formatClock,
  isUrgent,
  START_SECONDS,
  tick,
  URGENT_SECONDS,
} from './countdown'

describe('the clock', () => {
  it('starts full', () => {
    expect(createCountdown().remaining).toBe(START_SECONDS)
  })

  it('runs down', () => {
    const c = createCountdown()
    expect(tick(c, 5)).toBe(false)
    expect(c.remaining).toBe(START_SECONDS - 5)
  })

  it('expires exactly once it reaches zero, and never goes negative', () => {
    const c = createCountdown()
    expect(tick(c, START_SECONDS)).toBe(true)
    expect(c.remaining).toBe(0)
    expect(tick(c, 10)).toBe(true)
    expect(c.remaining).toBe(0)
  })
})

describe('extensions', () => {
  it('gives nothing for a lock that cleared nothing', () => {
    const c = createCountdown()
    tick(c, 20)
    expect(extend(c, 0)).toBe(0)
    expect(c.remaining).toBe(25)
  })

  it('follows the table', () => {
    for (let lines = 1; lines <= 4; lines++) {
      const c = createCountdown()
      tick(c, 30)
      expect(extend(c, lines)).toBe(EXTENSION_SECONDS[lines])
    }
  })

  it('is convex, so building beats chipping', () => {
    // A flush must be worth more than the four singles it replaces, or the
    // clock rewards clearing whatever lines up and the mode has no shape.
    const flush = EXTENSION_SECONDS[4]
    expect(flush).toBeGreaterThan(4 * EXTENSION_SECONDS[1])
    for (let n = 2; n <= 4; n++) {
      const step = EXTENSION_SECONDS[n] - EXTENSION_SECONDS[n - 1]
      const prev = EXTENSION_SECONDS[n - 1] - EXTENSION_SECONDS[n - 2]
      expect(step).toBeGreaterThan(prev)
    }
  })

  it('never banks past the starting value', () => {
    // Without the cap a strong player earns time faster than they spend it and
    // Countdown quietly turns back into Uptime.
    const c = createCountdown()
    for (let i = 0; i < 20; i++) extend(c, 4)
    expect(c.remaining).toBe(START_SECONDS)
  })

  it('reports what was actually granted near the ceiling', () => {
    const c = createCountdown()
    tick(c, 3)
    // A flush is worth fourteen, but only three seconds of room are left.
    expect(extend(c, 4)).toBe(3)
    expect(c.remaining).toBe(START_SECONDS)
  })

  it('can be extended after expiring, which is what a revive would need', () => {
    const c = createCountdown()
    tick(c, START_SECONDS)
    expect(extend(c, 1)).toBe(EXTENSION_SECONDS[1])
  })
})

describe('urgency', () => {
  it('turns urgent at the threshold', () => {
    const c = createCountdown()
    expect(isUrgent(c.remaining)).toBe(false)
    tick(c, START_SECONDS - URGENT_SECONDS)
    expect(isUrgent(c.remaining)).toBe(true)
  })
})

describe('formatting', () => {
  it('reads as minutes and padded seconds', () => {
    expect(formatClock(45)).toBe('0:45')
    expect(formatClock(9)).toBe('0:09')
    expect(formatClock(60)).toBe('1:00')
    expect(formatClock(0)).toBe('0:00')
  })

  it('rounds up, so the clock only shows zero when it is over', () => {
    expect(formatClock(0.2)).toBe('0:01')
  })

  it('never shows a negative', () => {
    expect(formatClock(-3)).toBe('0:00')
  })
})
