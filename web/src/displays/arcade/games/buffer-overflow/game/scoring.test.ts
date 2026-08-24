import { describe, expect, it } from 'vitest'
import {
  clearPoints,
  FLUSH_LINES,
  hardDropPoints,
  isStreakEligible,
  softDropPoints,
  type ClearOutcome,
} from './scoring'
import type { TwistKind } from './types'

const outcome = (o: Partial<ClearOutcome> = {}): ClearOutcome => ({
  lines: 0,
  twist: 'none',
  level: 1,
  combo: 0,
  streak: false,
  ...o,
})

describe('line values', () => {
  it('pays nothing for a lock that clears nothing', () => {
    expect(clearPoints(outcome())).toBe(0)
  })

  it('follows the base table at level one', () => {
    expect(clearPoints(outcome({ lines: 1 }))).toBe(100)
    expect(clearPoints(outcome({ lines: 2 }))).toBe(300)
    expect(clearPoints(outcome({ lines: 3 }))).toBe(500)
    expect(clearPoints(outcome({ lines: FLUSH_LINES }))).toBe(800)
  })

  it('makes a flush worth more than four singles', () => {
    // The whole reason to build a well instead of clearing whatever lines up.
    const flush = clearPoints(outcome({ lines: FLUSH_LINES }))
    const singles = 4 * clearPoints(outcome({ lines: 1 }))
    expect(flush).toBeGreaterThan(singles)
  })

  it('multiplies by the level', () => {
    expect(clearPoints(outcome({ lines: FLUSH_LINES, level: 7 }))).toBe(5600)
  })
})

describe('twists', () => {
  it('pays for a twist that cleared nothing', () => {
    expect(clearPoints(outcome({ twist: 'mini' }))).toBe(100)
    expect(clearPoints(outcome({ twist: 'full' }))).toBe(400)
  })

  it('pays a full twist far above the same line count without one', () => {
    const plain = clearPoints(outcome({ lines: 2 }))
    const twisted = clearPoints(outcome({ lines: 2, twist: 'full' }))
    expect(twisted).toBeGreaterThan(plain)
  })

  it('pays a mini less than a full', () => {
    const mini = clearPoints(outcome({ lines: 1, twist: 'mini' }))
    const full = clearPoints(outcome({ lines: 1, twist: 'full' }))
    expect(mini).toBeLessThan(full)
  })

  it('scales twists by the level too', () => {
    expect(clearPoints(outcome({ lines: 1, twist: 'full', level: 3 }))).toBe(
      2400,
    )
  })
})

describe('streaks', () => {
  it('counts a flush and any clearing twist, nothing else', () => {
    expect(isStreakEligible(FLUSH_LINES, 'none')).toBe(true)
    expect(isStreakEligible(1, 'full')).toBe(true)
    expect(isStreakEligible(1, 'mini')).toBe(true)
    expect(isStreakEligible(1, 'none')).toBe(false)
    expect(isStreakEligible(3, 'none')).toBe(false)
  })

  it('does not count a twist that cleared nothing', () => {
    // Otherwise a player holds a multiplier open by spinning in place.
    expect(isStreakEligible(0, 'full')).toBe(false)
  })

  it('adds half again to a streaking flush', () => {
    const plain = clearPoints(outcome({ lines: FLUSH_LINES }))
    const streaked = clearPoints(outcome({ lines: FLUSH_LINES, streak: true }))
    expect(streaked).toBe(Math.floor(plain * 1.5))
  })

  it('does not pay the multiplier on a clear that cannot keep a streak', () => {
    const plain = clearPoints(outcome({ lines: 1 }))
    expect(clearPoints(outcome({ lines: 1, streak: true }))).toBe(plain)
  })
})

describe('combos', () => {
  it('pays nothing on the first clear of a run', () => {
    expect(clearPoints(outcome({ lines: 1, combo: 0 }))).toBe(100)
  })

  it('grows with each consecutive clear', () => {
    expect(clearPoints(outcome({ lines: 1, combo: 1 }))).toBe(150)
    expect(clearPoints(outcome({ lines: 1, combo: 4 }))).toBe(300)
  })

  it('scales with the level', () => {
    expect(clearPoints(outcome({ lines: 1, combo: 2, level: 3 }))).toBe(600)
  })

  it('is not paid when nothing cleared', () => {
    expect(clearPoints(outcome({ lines: 0, combo: 5 }))).toBe(0)
  })
})

describe('drops', () => {
  it('pays per cell, and a hard drop double a soft one', () => {
    expect(softDropPoints(10)).toBe(10)
    expect(hardDropPoints(10)).toBe(20)
  })

  it('pays nothing for a piece that had nowhere to fall', () => {
    expect(hardDropPoints(0)).toBe(0)
  })
})

describe('the table as a whole', () => {
  it('never returns a fraction', () => {
    const twists: TwistKind[] = ['none', 'mini', 'full']
    for (const twist of twists) {
      for (let lines = 0; lines <= FLUSH_LINES; lines++) {
        for (const streak of [false, true]) {
          for (const combo of [0, 3]) {
            const points = clearPoints(
              outcome({ lines, twist, streak, combo, level: 6 }),
            )
            expect(Number.isInteger(points)).toBe(true)
            expect(points).toBeGreaterThanOrEqual(0)
          }
        }
      }
    }
  })
})
