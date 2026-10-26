import { describe, expect, it } from 'vitest'
import {
  apcaContrast,
  contrastOf,
  isAmbiguous,
  levelOf,
  wcagContrast,
  type Rgb,
} from './contrast'
import { unpackColors } from './colors'

const BLACK: Rgb = [0, 0, 0]
const WHITE: Rgb = [255, 255, 255]

describe('wcagContrast', () => {
  it('is 21 for black and white in either order', () => {
    expect(wcagContrast(BLACK, WHITE)).toBeCloseTo(21, 5)
    expect(wcagContrast(WHITE, BLACK)).toBeCloseTo(21, 5)
  })

  it('is 1 for a color on itself', () => {
    expect(wcagContrast([120, 30, 200], [120, 30, 200])).toBeCloseTo(1, 5)
  })
})

describe('apcaContrast', () => {
  it('is positive for dark text and negative for light text', () => {
    expect(apcaContrast(WHITE, BLACK)).toBeGreaterThan(100)
    expect(apcaContrast(BLACK, WHITE)).toBeLessThan(-100)
  })

  it('matches the published Lc of black on white and white on black', () => {
    expect(apcaContrast(WHITE, BLACK)).toBeCloseTo(106.04, 1)
    expect(apcaContrast(BLACK, WHITE)).toBeCloseTo(-107.88, 1)
  })

  it('is 0 for a color on itself', () => {
    expect(apcaContrast([90, 90, 90], [90, 90, 90])).toBe(0)
  })
})

describe('levelOf', () => {
  it('rates WCAG at 4.5 and 7', () => {
    expect(levelOf('wcag', 4.49)).toBe(1)
    expect(levelOf('wcag', 4.5)).toBe(2)
    expect(levelOf('wcag', 6.99)).toBe(2)
    expect(levelOf('wcag', 7)).toBe(3)
  })

  it('rates APCA by magnitude, so polarity does not matter', () => {
    expect(levelOf('apca', 89)).toBe(2)
    expect(levelOf('apca', -89)).toBe(2)
    expect(levelOf('apca', 90)).toBe(3)
    expect(levelOf('apca', -95)).toBe(3)
    expect(levelOf('apca', 76.5)).toBe(2)
    expect(levelOf('apca', 76.4)).toBe(1)
    expect(levelOf('apca', 0)).toBe(1)
  })
})

describe('isAmbiguous', () => {
  it('flags a WCAG ratio within 0.25 of a boundary', () => {
    expect(isAmbiguous('wcag', 4.6)).toBe(true)
    expect(isAmbiguous('wcag', 6.8)).toBe(true)
    expect(isAmbiguous('wcag', 5.5)).toBe(false)
    expect(isAmbiguous('wcag', 3)).toBe(false)
  })

  it('flags an APCA Lc within 5 of a boundary, either polarity', () => {
    expect(isAmbiguous('apca', 92)).toBe(true)
    expect(isAmbiguous('apca', -80)).toBe(true)
    expect(isAmbiguous('apca', 60)).toBe(false)
    expect(isAmbiguous('apca', -100)).toBe(false)
  })
})

describe('contrastOf', () => {
  it('dispatches on the algorithm', () => {
    expect(contrastOf('wcag', WHITE, BLACK)).toBeCloseTo(21, 5)
    expect(contrastOf('apca', WHITE, BLACK)).toBeGreaterThan(100)
  })
})

describe('unpackColors', () => {
  it('decodes six hex digits per color', () => {
    expect(unpackColors('ff0000007f10')).toEqual([
      [255, 0, 0],
      [0, 127, 16],
    ])
  })

  it('ignores a trailing partial entry', () => {
    expect(unpackColors('ffffffab')).toEqual([[255, 255, 255]])
  })
})
