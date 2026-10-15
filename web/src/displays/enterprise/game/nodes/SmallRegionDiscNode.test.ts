import { describe, expect, it } from 'vitest'
import {
  DISC_DIAMETER_CSS_PX,
  DISC_MIN_DIAMETER_CSS_PX,
  SmallRegionDiscNode,
  discDiameter,
} from './SmallRegionDiscNode'

describe('discDiameter', () => {
  it('is the design size on a 1080 tall canvas', () => {
    expect(discDiameter(1920, 1080)).toBe(DISC_DIAMETER_CSS_PX)
  })

  it('grows with a larger canvas and shrinks with a smaller one', () => {
    expect(discDiameter(3840, 2160)).toBeGreaterThan(DISC_DIAMETER_CSS_PX)
    expect(discDiameter(1400, 800)).toBeLessThan(DISC_DIAMETER_CSS_PX)
  })

  it('never drops below the tap target floor', () => {
    expect(discDiameter(400, 200)).toBe(DISC_MIN_DIAMETER_CSS_PX)
  })

  it('follows the constraining axis', () => {
    expect(discDiameter(1400, 600)).toBeCloseTo(
      Math.max(DISC_MIN_DIAMETER_CSS_PX, DISC_DIAMETER_CSS_PX * (600 / 1080)),
      6,
    )
  })
})

describe('SmallRegionDiscNode.contains', () => {
  it('is empty until the first draw gives it a radius', () => {
    const disc = new SmallRegionDiscNode('LUX', 100, 100)
    expect(disc.contains(100, 100)).toBe(true)
    expect(disc.contains(101, 100)).toBe(false)
  })

  it('covers the points within its radius', () => {
    const disc = new SmallRegionDiscNode('LUX', 100, 100)
    disc.radiusWorld = 10
    expect(disc.contains(105, 105)).toBe(true)
    expect(disc.contains(111, 100)).toBe(false)
  })
})
