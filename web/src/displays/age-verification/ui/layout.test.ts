import { describe, expect, it } from 'vitest'
import { visibleRect } from '@src/core/ui/designRegion'
import {
  COLUMN_GAP,
  DESIGN_LAYOUT,
  NAV_HEIGHT,
  ROW_WIDTH,
  inWorld,
  layoutFor,
} from './layout'

/** The layout of a window of this size in CSS pixels. */
function forWindow(width: number, height: number) {
  const area = visibleRect(width, height)
  return { area, layout: layoutFor(area.width, area.height) }
}

describe('layoutFor', () => {
  it('is the design at 16:9', () => {
    expect(DESIGN_LAYOUT).toMatchObject({
      rowX: 128,
      rowWidth: 1664,
      trailY: 63,
      navY: 951,
    })
    expect(DESIGN_LAYOUT.content).toEqual({
      x: 128,
      y: 159,
      width: 1664,
      height: 760,
    })
    expect(DESIGN_LAYOUT.left).toEqual({
      x: 128,
      y: 159,
      width: 768,
      height: 760,
    })
    expect(DESIGN_LAYOUT.right).toEqual({
      x: 1024,
      y: 159,
      width: 768,
      height: 760,
    })
  })

  it('is the same at any 16:9 size', () => {
    for (const [w, h] of [
      [1280, 720],
      [2560, 1440],
      [3840, 2160],
    ]) {
      const { layout } = forWindow(w, h)
      expect(layout.content).toEqual(DESIGN_LAYOUT.content)
      expect(layout.navY).toBe(951)
    }
  })

  it('keeps the row 1664 wide and centers it on a wide window', () => {
    const { layout } = forWindow(1920, 640)
    expect(layout.width).toBeCloseTo(3240)
    expect(layout.rowWidth).toBe(ROW_WIDTH)
    expect(layout.rowX).toBeCloseTo((3240 - 1664) / 2)
    expect(layout.right.x - (layout.left.x + layout.left.width)).toBe(
      COLUMN_GAP,
    )
    // The height is the design's, so the vertical layout is too.
    expect(layout.content.height).toBe(760)
    expect(layout.navY).toBe(951)
  })

  it('gives extra height to the content and keeps the buttons on the bottom edge', () => {
    const { layout } = forWindow(1600, 1200)
    expect(layout.height).toBeCloseTo(1440)
    expect(layout.content.height).toBeCloseTo(1440 - 159 - 161)
    expect(layout.trailY).toBe(63)
    expect(layout.navY + NAV_HEIGHT).toBeCloseTo(1440 - 65)
  })

  it('keeps the content between the progress row and the buttons', () => {
    for (const [w, h] of [
      [1920, 1080],
      [1600, 1200],
      [1100, 1080],
      [1920, 640],
      [900, 1400],
    ]) {
      const { layout } = forWindow(w, h)
      expect(layout.content.y).toBeGreaterThan(layout.trailY + 36)
      expect(layout.content.y + layout.content.height).toBeLessThan(layout.navY)
      // The row never leaves the visible area.
      expect(layout.rowX).toBeGreaterThanOrEqual(128 - 1e-9)
      expect(layout.rowX + layout.rowWidth).toBeLessThanOrEqual(
        layout.width - 128 + 1e-9,
      )
    }
  })

  it('splits the row into two equal columns around the gap', () => {
    const { layout } = forWindow(1500, 1000)
    expect(layout.left.width).toBe(layout.right.width)
    expect(layout.left.width * 2 + COLUMN_GAP).toBe(layout.rowWidth)
  })

  it('never goes negative for an area smaller than the design', () => {
    const layout = layoutFor(200, 100)
    expect(layout.rowWidth).toBe(0)
    expect(layout.content.height).toBe(0)
  })
})

describe('inWorld', () => {
  it('moves a box by the visible area origin', () => {
    const { area, layout } = forWindow(1920, 640)
    const box = inWorld(layout.right, area)
    expect(box.x).toBeCloseTo(layout.right.x + area.x)
    expect(box.y).toBeCloseTo(layout.right.y + area.y)
    expect(box.width).toBe(layout.right.width)
  })
})
