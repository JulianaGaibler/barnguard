import { describe, expect, it } from 'vitest'
import { overviewView, PICKER_MAP_HEIGHT_OVER_VIEW } from './overviewView'

const EUROPE = { x: 0, y: 0, width: 1134, height: 1167 }

describe('overviewView', () => {
  it('puts the map flush right and about 59% wide at 16:9', () => {
    const view = overviewView(EUROPE, 16 / 9)
    expect(view.x + view.width).toBeCloseTo(EUROPE.x + EUROPE.width, 6)
    expect(view.width / view.height).toBeCloseTo(16 / 9, 6)
    expect(EUROPE.width / view.width).toBeGreaterThan(0.58)
    expect(EUROPE.width / view.width).toBeLessThan(0.6)
  })

  it('draws the map slightly taller than the view and centres it', () => {
    const view = overviewView(EUROPE, 16 / 9)
    expect(EUROPE.height / view.height).toBeCloseTo(1.0803, 4)
    expect(view.y + view.height / 2).toBeCloseTo(EUROPE.height / 2, 6)
  })

  it('never lets the map pass 62% of the view width on a squarer window', () => {
    for (const aspect of [4 / 3, 1, 3 / 4]) {
      const view = overviewView(EUROPE, aspect)
      expect(EUROPE.width / view.width).toBeLessThanOrEqual(0.62 + 1e-9)
      expect(view.x + view.width).toBeCloseTo(EUROPE.width, 6)
      expect(view.width / view.height).toBeCloseTo(aspect, 6)
    }
  })

  it('keeps the whole map height in view on a squarer window', () => {
    const view = overviewView(EUROPE, 4 / 3)
    expect(view.height).toBeGreaterThanOrEqual(EUROPE.height / 1.0803 - 1e-9)
  })

  it('reveals more to the left on a wider window and keeps the map size', () => {
    const wide = overviewView(EUROPE, 21 / 9)
    const base = overviewView(EUROPE, 16 / 9)
    expect(wide.height).toBeCloseTo(base.height, 6)
    expect(wide.width).toBeGreaterThan(base.width)
    expect(wide.x).toBeLessThan(base.x)
  })

  it('offsets from a map that does not start at the origin', () => {
    const view = overviewView(
      { x: 100, y: 50, width: 1134, height: 1167 },
      16 / 9,
    )
    expect(view.x + view.width).toBeCloseTo(1234, 6)
    expect(view.y + view.height / 2).toBeCloseTo(50 + 1167 / 2, 6)
  })

  it('fits the whole map with an even margin for the picker', () => {
    const view = overviewView(EUROPE, 16 / 9, PICKER_MAP_HEIGHT_OVER_VIEW)
    const margin = (view.height - EUROPE.height) / 2
    expect(margin).toBeGreaterThan(0)
    expect(view.y).toBeCloseTo(EUROPE.y - margin, 6)
    expect(view.x + view.width).toBeCloseTo(EUROPE.width + margin, 6)
    expect(view.width / view.height).toBeCloseTo(16 / 9, 6)
  })

  it('falls back to 16:9 for a degenerate aspect', () => {
    expect(overviewView(EUROPE, 0)).toEqual(overviewView(EUROPE, 16 / 9))
  })
})
