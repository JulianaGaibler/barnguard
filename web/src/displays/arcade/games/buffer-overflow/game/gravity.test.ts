import { describe, expect, it } from 'vitest'
import {
  levelForLines,
  LINES_PER_LEVEL,
  MAX_LEVEL,
  MIN_SECONDS_PER_ROW,
  secondsPerRow,
  SOFT_DROP_FACTOR,
  SOFT_DROP_SLOWEST,
  softDropSecondsPerRow,
} from './gravity'

describe('levels', () => {
  it('starts at one', () => {
    expect(levelForLines(0)).toBe(1)
  })

  it('ticks up every ten lines', () => {
    expect(levelForLines(LINES_PER_LEVEL - 1)).toBe(1)
    expect(levelForLines(LINES_PER_LEVEL)).toBe(2)
    expect(levelForLines(LINES_PER_LEVEL * 9)).toBe(10)
  })

  it('keeps climbing past the gravity cap, since it also multiplies score', () => {
    expect(levelForLines(LINES_PER_LEVEL * 40)).toBe(41)
  })
})

describe('gravity', () => {
  it('drops one row a second at level one', () => {
    expect(secondsPerRow(1)).toBeCloseTo(1, 6)
  })

  it('gets strictly faster every level up to the cap', () => {
    for (let level = 2; level <= MAX_LEVEL; level++) {
      expect(secondsPerRow(level)).toBeLessThan(secondsPerRow(level - 1))
    }
  })

  it('stops getting faster past the cap', () => {
    const capped = secondsPerRow(MAX_LEVEL)
    expect(secondsPerRow(MAX_LEVEL + 1)).toBe(capped)
    expect(secondsPerRow(999)).toBe(capped)
  })

  it('never falls below the floor', () => {
    for (let level = 1; level <= 60; level++) {
      expect(secondsPerRow(level)).toBeGreaterThanOrEqual(MIN_SECONDS_PER_ROW)
    }
  })

  it('clamps a level below one rather than inverting the curve', () => {
    expect(secondsPerRow(0)).toBe(secondsPerRow(1))
    expect(secondsPerRow(-5)).toBe(secondsPerRow(1))
  })

  it('is still playable at the point the curve caps out', () => {
    // A twenty-row buffer crossed in under a fifth of a second is the fastest
    // the game ever gets. Past that the difference is not perceivable.
    expect(secondsPerRow(MAX_LEVEL) * 20).toBeLessThan(0.25)
  })
})

describe('soft drop', () => {
  it('holds a steady rate over the levels where gravity is slow', () => {
    // The floor is what the control feels like for most of a run, so it is
    // worth pinning as a rate rather than as a ratio: nine rows a second, fast
    // enough to be worth pressing and slow enough to release on a chosen row.
    expect(1 / softDropSecondsPerRow(1)).toBeCloseTo(9.1, 1)
    expect(softDropSecondsPerRow(3)).toBeCloseTo(softDropSecondsPerRow(1), 6)
  })

  it('lets the multiple take over once gravity outruns the floor', () => {
    // Two regimes, and the handover has to be somewhere in the middle of a run
    // rather than at either end, or one of the two constants is dead weight.
    const handover = Array.from({ length: 40 }, (_, i) => i + 1).find(
      (level) => secondsPerRow(level) / SOFT_DROP_FACTOR < SOFT_DROP_SLOWEST,
    )
    expect(handover).toBeGreaterThan(3)
    expect(handover).toBeLessThan(12)
    expect(softDropSecondsPerRow(20)).toBeCloseTo(
      secondsPerRow(20) / SOFT_DROP_FACTOR,
      9,
    )
  })

  it('always beats gravity by the full multiple once past the floor', () => {
    for (let level = 12; level <= 20; level++) {
      expect(secondsPerRow(level) / softDropSecondsPerRow(level)).toBeCloseTo(
        SOFT_DROP_FACTOR,
        6,
      )
    }
  })

  it('is never slower than plain gravity at any level', () => {
    for (let level = 1; level <= 40; level++) {
      expect(softDropSecondsPerRow(level)).toBeLessThanOrEqual(
        secondsPerRow(level),
      )
    }
  })

  it('honours the same floor', () => {
    for (let level = 1; level <= 40; level++) {
      expect(softDropSecondsPerRow(level)).toBeGreaterThanOrEqual(
        MIN_SECONDS_PER_ROW,
      )
    }
  })
})
