import { describe, expect, it } from 'vitest'
import { DIGIT_CELL_EM, isDigit, monoChars, splitScore } from './splitScore'

const text = (chars: { char: string }[]) => chars.map((c) => c.char).join('')
const dim = (chars: { dim: boolean }[]) => chars.map((c) => c.dim)

describe('splitScore', () => {
  it('pads to three digits and dims the padding', () => {
    expect(text(splitScore(7))).toBe('007')
    expect(dim(splitScore(7))).toEqual([true, true, false])
    expect(dim(splitScore(42))).toEqual([true, false, false])
  })

  it('keeps the last digit bright for a score of zero', () => {
    expect(text(splitScore(0))).toBe('000')
    expect(dim(splitScore(0))).toEqual([true, true, false])
  })

  it('dims nothing once the score fills three digits', () => {
    expect(dim(splitScore(100))).toEqual([false, false, false])
    expect(dim(splitScore(999))).toEqual([false, false, false])
  })

  it('shows every digit of a score past 999', () => {
    expect(text(splitScore(1204))).toBe('1204')
    expect(dim(splitScore(1204))).toEqual([false, false, false, false])
  })

  it('reads a bad score as zero and truncates a fractional one', () => {
    expect(text(splitScore(-5))).toBe('000')
    expect(text(splitScore(Number.NaN))).toBe('000')
    expect(text(splitScore(Infinity))).toBe('000')
    expect(text(splitScore(12.9))).toBe('012')
  })
})

describe('monoChars', () => {
  it('splits text into undimmed characters', () => {
    expect(text(monoChars('1:05'))).toBe('1:05')
    expect(dim(monoChars('1:05'))).toEqual([false, false, false, false])
  })
})

describe('isDigit', () => {
  it('matches only ASCII digits', () => {
    expect(isDigit('0')).toBe(true)
    expect(isDigit('9')).toBe(true)
    expect(isDigit(':')).toBe(false)
    expect(isDigit('a')).toBe(false)
    expect(isDigit('٣')).toBe(false)
  })
})

describe('DIGIT_CELL_EM', () => {
  it('holds the widest digit advance measured from each face', () => {
    expect(DIGIT_CELL_EM).toEqual({
      text: 0.687,
      headline: 0.66,
      headlineCondensed: 0.468,
      headlineExtended: 0.782,
    })
  })
})
