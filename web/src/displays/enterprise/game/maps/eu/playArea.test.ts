import { describe, expect, it } from 'vitest'
import { fitRegionBand, ScreenEdgeMask } from './playArea'

const VIEW = { x: 100, y: 50, width: 800, height: 450 }

describe('ScreenEdgeMask', () => {
  const mask = new ScreenEdgeMask(() => VIEW)

  it('loses a packet past the left or right edge only', () => {
    expect(mask.contains(500, 200, 0)).toBe(true)
    expect(mask.contains(99, 200, 0)).toBe(false)
    expect(mask.contains(901, 200, 0)).toBe(false)
  })

  it('never loses a packet vertically, however far out', () => {
    // The top and bottom are the viewport turnaround's job, not the exit
    // gate's. A packet above the view is still in play and gets steered back.
    expect(mask.contains(500, -10_000, 0)).toBe(true)
    expect(mask.contains(500, 10_000, 0)).toBe(true)
  })

  it('reports not-contained inside the inset band on the sides', () => {
    // `PacketBehavior` reads the inset to decide whether to steer a packet
    // back toward the centre. False here is what lets it fly out sideways
    // instead of bouncing.
    expect(mask.contains(104, 200, 8)).toBe(false)
    expect(mask.contains(896, 200, 8)).toBe(false)
    expect(mask.contains(120, 200, 8)).toBe(true)
  })

  it('keeps the inset open vertically, so top and bottom still turn packets', () => {
    expect(mask.contains(500, 51, 8)).toBe(true)
    expect(mask.contains(500, 499, 8)).toBe(true)
  })

  it('follows the live viewport', () => {
    let view = { x: 0, y: 0, width: 100, height: 100 }
    const live = new ScreenEdgeMask(() => view)
    expect(live.contains(150, 0, 0)).toBe(false)
    view = { x: 0, y: 0, width: 400, height: 100 }
    expect(live.contains(150, 0, 0)).toBe(true)
  })
})

describe('fitRegionBand', () => {
  const MAP = { x: 0, y: 0, width: 1134, height: 1167 }
  const WIDE = 16 / 9

  it("always frames the map's full width, whatever the region", () => {
    // Cutting the map off on the left or right is the thing this must never
    // do, so the width is not a function of the region at all.
    const tiny = { x: 560, y: 500, width: 9, height: 12 }
    const big = { x: 100, y: 200, width: 900, height: 700 }
    expect(fitRegionBand(tiny, MAP, WIDE).width).toBe(MAP.width)
    expect(fitRegionBand(big, MAP, WIDE).width).toBe(MAP.width)
    expect(fitRegionBand(tiny, MAP, WIDE).x).toBe(MAP.x)
  })

  it('takes its height from the canvas aspect, so the view fits exactly', () => {
    // An exact fit is what puts the map's left and right edges on the
    // screen's, which is what makes the screen-edge loss fair.
    for (const aspect of [16 / 9, 4 / 3, 21 / 9]) {
      const band = fitRegionBand(
        { x: 0, y: 500, width: 10, height: 10 },
        MAP,
        aspect,
      )
      expect(band.width / band.height).toBeCloseTo(aspect, 6)
    }
  })

  it('zooms every region by the same amount', () => {
    const a = fitRegionBand({ x: 0, y: 100, width: 9, height: 9 }, MAP, WIDE)
    const b = fitRegionBand(
      { x: 900, y: 900, width: 300, height: 400 },
      MAP,
      WIDE,
    )
    expect(a.height).toBeCloseTo(b.height, 6)
  })

  it('centres the band on the region', () => {
    const band = fitRegionBand(
      { x: 400, y: 500, width: 100, height: 100 },
      MAP,
      WIDE,
    )
    expect(band.y + band.height / 2).toBeCloseTo(550, 6)
  })

  it('holds a tall northern region fully on screen', () => {
    // Norway: centring on its deepest interior point (in the south) would push
    // the north off screen, so the band follows the bounds instead.
    const norway = { x: 700, y: 20, width: 298, height: 407 }
    const band = fitRegionBand(norway, MAP, WIDE)
    expect(band.y).toBeLessThanOrEqual(norway.y)
    expect(band.y + band.height).toBeGreaterThanOrEqual(
      norway.y + norway.height,
    )
  })

  it('keeps the band inside the map vertically', () => {
    const top = { x: 400, y: 0, width: 50, height: 40 }
    const bottom = { x: 400, y: 1120, width: 50, height: 40 }
    const a = fitRegionBand(top, MAP, WIDE)
    const b = fitRegionBand(bottom, MAP, WIDE)
    expect(a.y).toBeGreaterThanOrEqual(MAP.y)
    expect(b.y + b.height).toBeLessThanOrEqual(MAP.y + MAP.height + 1e-6)
  })

  it('centres a band taller than the map rather than inverting', () => {
    // A canvas narrower than the map's own aspect wants more height than the
    // map has. Letterboxing above and below beats a flipped clamp.
    const band = fitRegionBand(
      { x: 400, y: 600, width: 50, height: 50 },
      MAP,
      0.5,
    )
    expect(band.height).toBeGreaterThan(MAP.height)
    expect(band.y + band.height / 2).toBeCloseTo(MAP.y + MAP.height / 2, 6)
  })
})
