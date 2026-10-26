import { describe, expect, it } from 'vitest'
import { pickFrame } from './frame'
import { splashLayoutFor } from './splashLayout'

const layoutAt = (width: number, height: number) =>
  splashLayoutFor(width, height, pickFrame(width, height))

describe('splashLayoutFor', () => {
  it('puts the panel and its steps where the design has them at 1920 by 1080', () => {
    const layout = layoutAt(1920, 1080)
    expect(layout.stacked).toBe(false)
    expect(layout.panel).toEqual({ x: 838, y: 0, width: 1082, height: 1080 })
    expect(layout.outline).toEqual([
      { x: 100, y: 0 },
      { x: 100, y: 337 },
      { x: 0, y: 337 },
      { x: 0, y: 961 },
      { x: 57, y: 961 },
      { x: 57, y: 1080 },
      { x: 1082, y: 1080 },
      { x: 1082, y: 0 },
    ])
  })

  it('keeps the text left of the panel, clear of its steps', () => {
    for (const [width, height] of [
      [1920, 1080],
      [1440, 1080],
      [2560, 1080],
    ] as const) {
      const { text, panel } = layoutAt(width, height)
      expect(text.x).toBe(105)
      expect(text.x + text.width).toBeLessThan(panel.x)
      expect(panel.x + panel.width).toBe(width)
    }
  })

  it('keeps the text clear of the safe area', () => {
    const insets = { top: 20, right: 0, bottom: 30, left: 40 }
    const { text } = splashLayoutFor(1920, 1080, pickFrame(1920, 1080), insets)
    expect(text.x).toBe(145)
    expect(text.y).toBe(20)
    expect(text.height).toBe(1030)
  })

  it('runs the panel across the top of a portrait screen, the text under it', () => {
    const layout = layoutAt(960, 1800)
    expect(layout.stacked).toBe(true)
    expect(layout.panel.x).toBe(0)
    expect(layout.panel.y).toBe(0)
    expect(layout.panel.width).toBe(960)
    expect(layout.text.y).toBeGreaterThan(layout.panel.height)
    expect(layout.text.y + layout.text.height).toBeLessThanOrEqual(1800)
    for (const point of layout.outline) {
      expect(point.y).toBeLessThanOrEqual(layout.panel.height)
    }
  })
})
