import { describe, expect, it } from 'vitest'
import { paintCalls } from 'stargazer'
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
  it('covers the points within its radius at the given view scale', () => {
    const disc = new SmallRegionDiscNode('LUX', 100, 100)
    disc.diameterCssPx = 20
    expect(disc.contains(105, 105, 1)).toBe(true)
    expect(disc.contains(111, 100, 1)).toBe(false)
    expect(disc.contains(111, 100, 2)).toBe(true)
  })
})

describe('SmallRegionDiscNode paint', () => {
  it('sizes the disc from the screen scale and leaves the node untouched', () => {
    const disc = new SmallRegionDiscNode('LUX', 100, 100)
    disc.diameterCssPx = 20
    const calls = paintCalls(disc, { screenScale: 3 })
    const circle = calls.find((c) => c.name === 'fillCircle')
    expect(circle?.args.slice(0, 3)).toEqual([0, 0, 30])
  })

  it('repaints when selected or resized', () => {
    const disc = new SmallRegionDiscNode('LUX', 100, 100)
    paintCalls(disc)
    const fills = (selected: boolean): unknown => {
      disc.selected = selected
      return paintCalls(disc).find((c) => c.name === 'fillCircle')?.args[3]
    }
    expect(fills(true)).not.toEqual(fills(false))
  })
})
