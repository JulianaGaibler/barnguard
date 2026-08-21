// The name is the one thing on a card drawn under a rotation, so its direction
// is the one thing that can silently come out backwards. A quarter turn the
// wrong way runs the word up the ribbon instead of down, which reads as though
// the card had been flipped.

import { describe, expect, it } from 'vitest'
import { ribbonTextAnchor } from './CardNode'
import { CARD } from '../tuning'

/** Where the rotation carries a local vector, in screen space (Y down). */
function rotated(v: { x: number; y: number }, rad: number) {
  const cos = Math.cos(rad)
  const sin = Math.sin(rad)
  return { x: v.x * cos - v.y * sin, y: v.x * sin + v.y * cos }
}

describe('card name ribbon', () => {
  const anchor = ribbonTextAnchor(200, 280)

  it('runs the name down the card, not up it', () => {
    const advance = rotated({ x: 1, y: 0 }, anchor.rotation)
    expect(advance.y).toBeCloseTo(1, 6)
    expect(advance.x).toBeCloseTo(0, 6)
  })

  it('is a rotation, never a reflection', () => {
    // A negative determinant would mirror the glyphs.
    const cos = Math.cos(anchor.rotation)
    const sin = Math.sin(anchor.rotation)
    expect(cos * cos - -sin * sin).toBeCloseTo(1, 6)
  })

  it('starts below the cost coin and stays on the ribbon', () => {
    const w = 200
    const h = 280
    // Clear of the coin, which overlaps the top of the ribbon.
    expect(anchor.y).toBeGreaterThan(h * CARD.coinRadiusFrac)
    // Centred across the ribbon's width.
    expect(anchor.x).toBeCloseTo(w * CARD.ribbonWidthFrac * 0.5, 6)
    expect(anchor.x).toBeLessThan(w * CARD.ribbonWidthFrac)
  })

  it('leaves a run of ribbon for the name to occupy', () => {
    const h = 280
    const run = h * CARD.ribbonTextBottomFrac - anchor.y
    expect(run).toBeGreaterThan(h * 0.5)
  })

  it('scales with the card', () => {
    const small = ribbonTextAnchor(100, 140)
    expect(small.x).toBeCloseTo(anchor.x / 2, 6)
    expect(small.y).toBeCloseTo(anchor.y / 2, 6)
    expect(small.rotation).toBe(anchor.rotation)
  })
})
