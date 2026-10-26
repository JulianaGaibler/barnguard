import { describe, expect, it } from 'vitest'
import { ALGORITHMS, contrastOf, isAmbiguous, levelOf } from './contrast'
import { unpackColors } from './colors'
import { PACKED_COLORS } from './colorList'
import { EXAMPLES, newExample } from './examples'
import { LEVELS } from './contrast'
import { seededRandom } from './round'

describe('the splash examples', () => {
  for (const algorithm of ALGORITHMS) {
    for (const example of EXAMPLES) {
      it(`rate as level ${example.level} under ${algorithm}, clear of a boundary`, () => {
        const contrast = contrastOf(algorithm, example.background, example.text)
        expect(levelOf(algorithm, contrast)).toBe(example.level)
        expect(isAmbiguous(algorithm, contrast)).toBe(false)
      })
    }
  }
})

describe('newExample', () => {
  const colors = unpackColors(PACKED_COLORS)

  for (const level of LEVELS) {
    it(`draws level ${level} pairs both algorithms agree on`, () => {
      const random = seededRandom(level)
      for (let i = 0; i < 25; i++) {
        const example = newExample(colors, level, random)
        expect(example.level).toBe(level)
        for (const algorithm of ALGORITHMS) {
          const contrast = contrastOf(
            algorithm,
            example.background,
            example.text,
          )
          expect(levelOf(algorithm, contrast)).toBe(level)
          expect(isAmbiguous(algorithm, contrast)).toBe(false)
        }
      }
    })
  }

  it('keeps the thumbs of a poor card visible', () => {
    const random = seededRandom(9)
    for (let i = 0; i < 25; i++) {
      const { background, text } = newExample(colors, 1, random)
      expect(Math.abs(contrastOf('apca', background, text))).toBeGreaterThan(24)
      expect(contrastOf('wcag', background, text)).toBeGreaterThan(1.39)
    }
  })

  it('falls back to the fixed example with nothing to draw from', () => {
    expect(newExample([], 2, seededRandom(1))).toBe(EXAMPLES[1])
  })
})
