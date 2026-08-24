import { describe, expect, it } from 'vitest'
import {
  ELEVATION,
  PX_TO_M,
  flatForeshortening,
  groundDepthForScreenHeight,
  groundFromLayout,
  layoutFromWorld,
} from './project'
import { BUTTONS } from './tuning'

// The whole scene is positioned by reading coordinates off the reference art,
// so these pin the projection against points measured from `layout.svg`. If a
// number here moves, every mesh in the game moves with it.

const REGION_CENTRE = { x: 960, y: 540 }

describe('groundFromLayout and layoutFromWorld', () => {
  it('round-trips an arbitrary layout point', () => {
    const back = layoutFromWorld(groundFromLayout(1234, 321))
    expect(back.x).toBeCloseTo(1234, 6)
    expect(back.y).toBeCloseTo(321, 6)
  })

  it('puts the region centre at the world origin', () => {
    const p = groundFromLayout(REGION_CENTRE.x, REGION_CENTRE.y)
    expect(p).toEqual({ x: 0, y: 0, z: 0 })
  })

  it('keeps the table on the y = 0 plane', () => {
    expect(groundFromLayout(0, 0).y).toBe(0)
    expect(groundFromLayout(1920, 1080).y).toBe(0)
  })

  it('measures width straight across, with no foreshortening', () => {
    // The two buttons are 307 layout px apart in the art.
    const left = groundFromLayout(806, 779.5)
    const right = groundFromLayout(1113, 779.5)
    expect(right.x - left.x).toBeCloseTo(307 * PX_TO_M, 9)
  })

  it('stretches depth, because the camera looks along it', () => {
    const near = groundFromLayout(960, 1000)
    const far = groundFromLayout(960, 500)
    const screenSpan = (1000 - 500) * PX_TO_M
    expect(near.z - far.z).toBeGreaterThan(screenSpan)
    expect(near.z - far.z).toBeCloseTo(screenSpan / Math.sin(ELEVATION), 9)
  })

  it('projects a raised point further up the screen', () => {
    const onTable = groundFromLayout(960, 800)
    const raised = { ...onTable, y: 0.1 }
    expect(layoutFromWorld(raised).y).toBeLessThan(layoutFromWorld(onTable).y)
  })

  it('writes into a caller-owned output', () => {
    const out = { x: 0, y: 0, z: 0 }
    expect(groundFromLayout(100, 200, out)).toBe(out)
    const flat = { x: 0, y: 0 }
    expect(layoutFromWorld(out, flat)).toBe(flat)
  })
})

describe('the reference art', () => {
  // Measured off layout.svg. Each button is three stacked ellipses, and the
  // gap between the base centre and the cap centre is what fixes the height.
  const BUTTON_BASE = { x: 806, y: 779.5 }
  const BUTTON_CAP = { x: 806, y: 733 }
  const MOUTH = { x: 959.5, y: 1067 }

  it('places the left button where it is drawn', () => {
    const p = layoutFromWorld(groundFromLayout(BUTTON_BASE.x, BUTTON_BASE.y))
    expect(p.x).toBeCloseTo(BUTTON_BASE.x, 6)
    expect(p.y).toBeCloseTo(BUTTON_BASE.y, 6)
  })

  it('derives a button height that lands its cap where it is drawn', () => {
    // A vertical offset projects to `h * cos(ELEVATION)` on screen. The rise is
    // what the art draws, so the buttons can move without the shape changing.
    expect(BUTTONS.capRiseOnScreen).toBeCloseTo(BUTTON_BASE.y - BUTTON_CAP.y, 6)
    const riseOnScreen = BUTTONS.capRiseOnScreen
    const height = (riseOnScreen * PX_TO_M) / Math.cos(ELEVATION)
    const base = groundFromLayout(BUTTON_BASE.x, BUTTON_BASE.y)
    const cap = layoutFromWorld({ ...base, y: height })
    expect(cap.y).toBeCloseTo(BUTTON_CAP.y, 6)
    // Roughly 53mm, a chunky arcade button rather than a coin.
    expect(height).toBeGreaterThan(0.04)
    expect(height).toBeLessThan(0.07)
  })

  it('puts the mouth below the buttons and near the bottom edge', () => {
    const mouth = groundFromLayout(MOUTH.x, MOUTH.y)
    const button = groundFromLayout(BUTTON_BASE.x, BUTTON_BASE.y)
    expect(mouth.z).toBeGreaterThan(button.z)
    expect(layoutFromWorld(mouth).y).toBeGreaterThan(1000)
  })
})

describe('flat spans', () => {
  it('costs a flat card most of its length', () => {
    // A card is 194 design px long lying away from the camera.
    const onScreen = flatForeshortening(194)
    expect(onScreen).toBeCloseTo(194 * Math.sin(ELEVATION), 6)
    // Under half, which is why the active hand lifts to be read.
    expect(onScreen / 194).toBeLessThan(0.5)
  })

  it('sizes ground art so it lands on screen at its drawn height', () => {
    const depth = groundDepthForScreenHeight(252)
    const near = groundFromLayout(960, 1067 + 126)
    const far = { ...near, z: near.z - depth }
    expect(layoutFromWorld(near).y - layoutFromWorld(far).y).toBeCloseTo(252, 6)
  })
})
