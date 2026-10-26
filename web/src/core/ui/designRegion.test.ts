import { describe, expect, it } from 'vitest'
import { DESIGN_HEIGHT, DESIGN_WIDTH, visibleRect } from './designRegion'

describe('visibleRect', () => {
  it('is the design region at 16:9, at any size', () => {
    for (const [w, h] of [
      [1920, 1080],
      [3840, 2160],
      [960, 540],
    ]) {
      const rect = visibleRect(w, h)
      expect(rect.x).toBeCloseTo(0, 6)
      expect(rect.y).toBeCloseTo(0, 6)
      expect(rect.width).toBeCloseTo(DESIGN_WIDTH, 6)
      expect(rect.height).toBeCloseTo(DESIGN_HEIGHT, 6)
    }
  })

  it('reaches past the sides on a wide window and keeps the height', () => {
    const rect = visibleRect(2560, 1080)
    expect(rect.height).toBeCloseTo(DESIGN_HEIGHT, 6)
    expect(rect.width).toBeGreaterThan(DESIGN_WIDTH)
    expect(rect.x + rect.width / 2).toBeCloseTo(DESIGN_WIDTH / 2, 6)
  })

  it('reaches past the top and bottom on a tall window and keeps the width', () => {
    const rect = visibleRect(1440, 1080)
    expect(rect.width).toBeCloseTo(DESIGN_WIDTH, 6)
    expect(rect.height).toBeGreaterThan(DESIGN_HEIGHT)
    expect(rect.y + rect.height / 2).toBeCloseTo(DESIGN_HEIGHT / 2, 6)
  })

  it('keeps the canvas aspect', () => {
    const rect = visibleRect(1400, 600)
    expect(rect.width / rect.height).toBeCloseTo(1400 / 600, 6)
  })

  it('falls back to the design region for an empty canvas', () => {
    expect(visibleRect(0, 0)).toEqual({
      x: 0,
      y: 0,
      width: DESIGN_WIDTH,
      height: DESIGN_HEIGHT,
    })
  })
})
