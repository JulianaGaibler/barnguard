import { describe, expect, it } from 'vitest'
import { isAmbiguous, contrastOf, levelOf, type Rgb } from './contrast'
import { newRound, seededRandom } from './round'
import { PACKED_COLORS } from './colorList'
import { unpackColors } from './colors'

const COLORS = unpackColors(PACKED_COLORS)

describe('the color list', () => {
  it('holds the website list', () => {
    expect(COLORS.length).toBe(30252)
  })
})

describe('newRound', () => {
  for (const algorithm of ['apca', 'wcag'] as const) {
    it(`never returns an ambiguous pair under ${algorithm}`, () => {
      const random = seededRandom(1)
      for (let i = 0; i < 300; i++) {
        const round = newRound(algorithm, COLORS, random)
        expect(isAmbiguous(algorithm, round.contrast)).toBe(false)
        expect(round.contrast).toBeCloseTo(
          contrastOf(algorithm, round.background, round.text),
          9,
        )
        expect(levelOf(algorithm, round.contrast)).toBe(round.level)
      }
    })

    it(`comes up with all three levels under ${algorithm}`, () => {
      const random = seededRandom(2)
      const counts = { 1: 0, 2: 0, 3: 0 }
      for (let i = 0; i < 600; i++)
        counts[newRound(algorithm, COLORS, random).level]++
      for (const level of [1, 2, 3] as const) {
        expect(counts[level]).toBeGreaterThan(120)
      }
    })
  }

  it('repeats for the same seed', () => {
    const a = newRound('apca', COLORS, seededRandom(9))
    const b = newRound('apca', COLORS, seededRandom(9))
    expect(a).toEqual(b)
  })

  it('settles for a clear pair when the list cannot make the level', () => {
    const black: Rgb = [0, 0, 0]
    const white: Rgb = [255, 255, 255]
    const round = newRound('wcag', [black, white], () => 0.5)
    expect(round.level).toBe(levelOf('wcag', round.contrast))
  })

  it('throws on an empty list', () => {
    expect(() => newRound('apca', [], Math.random)).toThrow()
  })
})
