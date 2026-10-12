import { describe, expect, it } from 'vitest'
import { fitRegionView, ScreenEdgeMask } from './playArea'

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

describe('fitRegionView', () => {
  const MAP = { x: 0, y: 0, width: 1134, height: 1167 }
  const opts = { padding: 1.3, minWidth: 700 }

  it('never frames narrower than the minimum, however small the region', () => {
    // Gameplay distances are tuned in map units, so a view scaled to a
    // 9-unit country would leave no room to play.
    const tiny = { x: 560, y: 500, width: 9, height: 12 }
    const view = fitRegionView(tiny, { x: 564, y: 506 }, MAP, 16 / 9, opts)
    expect(view.width).toBe(700)
    expect(view.height).toBeCloseTo(700 / (16 / 9), 3)
  })

  it('grows to hold a tall region on the vertical axis', () => {
    // Norway is taller than it is wide, so the width has to come from the
    // height times the aspect or the country would not fit on screen.
    const tall = { x: 700, y: 20, width: 298, height: 407 }
    const view = fitRegionView(tall, { x: 850, y: 220 }, MAP, 16 / 9, opts)
    expect(view.height).toBeGreaterThanOrEqual(407)
  })

  it('never frames wider than the map', () => {
    const huge = { x: 0, y: 0, width: 1100, height: 1100 }
    const view = fitRegionView(huge, { x: 550, y: 550 }, MAP, 16 / 9, opts)
    expect(view.width).toBeLessThanOrEqual(MAP.width)
  })

  it('slides a corner region back inside the map', () => {
    // Cyprus sits at the far bottom right. Centring on it alone would frame
    // empty space past the edge.
    const corner = { x: 1080, y: 1120, width: 30, height: 20 }
    const view = fitRegionView(corner, { x: 1095, y: 1130 }, MAP, 16 / 9, opts)
    expect(view.x + view.width).toBeLessThanOrEqual(MAP.width + 1e-6)
    expect(view.y + view.height).toBeLessThanOrEqual(MAP.height + 1e-6)
    expect(view.x).toBeGreaterThanOrEqual(0)
  })

  it('centres on the region when the framing cannot fit the map', () => {
    // A very wide canvas can want a view taller than the map allows. Centring
    // beats inverting the clamp and jumping somewhere arbitrary.
    const narrowMap = { x: 0, y: 0, width: 1134, height: 200 }
    const view = fitRegionView(
      { x: 500, y: 90, width: 20, height: 20 },
      { x: 510, y: 100 },
      narrowMap,
      1,
      opts,
    )
    expect(Number.isFinite(view.y)).toBe(true)
    expect(view.height).toBeGreaterThan(narrowMap.height)
  })
})
