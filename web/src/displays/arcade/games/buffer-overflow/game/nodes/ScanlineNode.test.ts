/**
 * The scanline field's arithmetic.
 *
 * All of it is about landing on the device pixel grid, which is the one thing
 * that decides whether the effect reads as a CRT or as a shimmer. A bar that
 * lands half a hardware row off covers two rows at half strength, and when
 * consecutive bars land at different fractions the field beats against itself.
 * None of that shows up in a screenshot at one particular size, so it is pinned
 * here across the ratios a cabinet and a laptop actually produce.
 *
 * The fake camera derives `deviceScale` from the pixel ratio and the camera
 * scale rather than taking it as its own number. The two are not independent:
 * `deviceScale` is device pixels per WORLD unit, so it already has the camera
 * scale folded into it. A fake that lets them disagree describes a canvas that
 * cannot exist, and will happily agree with an implementation that has the
 * conversion backwards.
 */
import { describe, expect, it } from 'vitest'
import type { CameraView2D, Gfx2D } from '@src/stargazer'
import { ScanlineNode } from './ScanlineNode'
import type { Bounds } from '../types'

const REGION: Bounds = { x: 0, y: 0, width: 1920, height: 1080 }

interface Bar {
  x: number
  y: number
  w: number
  h: number
}

/**
 * Draw the field once and report the bars in device pixels.
 *
 * `scale` is world units per CSS pixel, which is what a camera hands a node,
 * and `dpr` is hardware pixels per CSS pixel. The two together are the only
 * thing standing between a world-space size and the grid it has to land on.
 */
function draw(opts: {
  scale?: number
  dpr?: number
  region?: Bounds
  view?: Bounds
}): { bars: Bar[]; perWorld: number; view: Bounds } {
  const scale = opts.scale ?? 1
  const dpr = opts.dpr ?? 1
  const view = opts.view ?? {
    x: 0,
    y: 0,
    width: 1920 * scale,
    height: 1080 * scale,
  }
  // Device pixels per world unit: the pixel ratio, with the camera's zoom in it.
  const perWorld = dpr / scale
  const raw: Bar[] = []
  const gfx = {
    deviceScale: () => perWorld,
    // The real one, from `GpuGfx`, so the test cannot pass against a snap the
    // engine would not perform.
    snapSize: (v: number) =>
      perWorld > 0 ? Math.max(1, Math.round(v * perWorld)) / perWorld : v,
    fillRoundRect: (x: number, y: number, w: number, h: number) =>
      raw.push({ x, y, w, h }),
  } as unknown as Gfx2D
  const camera = {
    visibleWorldRect: () => view,
    strokeSpaceScale: () => scale,
  } as unknown as CameraView2D

  const node = new ScanlineNode()
  node.setRegion(opts.region ?? REGION)
  node.draw(gfx, camera)

  return {
    bars: raw.map((b) => ({
      x: b.x * perWorld,
      y: b.y * perWorld,
      w: b.w * perWorld,
      h: b.h * perWorld,
    })),
    perWorld,
    view,
  }
}

/** Ratios worth caring about: integer, the awkward 1.5, and a scaled cabinet. */
const SCALES = [1, 1.5, 2, 0.75, 0.5625]
const RATIOS = [1, 1.5, 2, 3]

const whole = (v: number): boolean => Math.abs(v - Math.round(v)) < 1e-9

describe('the device pixel grid', () => {
  it('puts every bar on it, at every scale and ratio', () => {
    for (const scale of SCALES) {
      for (const dpr of RATIOS) {
        const { bars, view, perWorld } = draw({ scale, dpr })
        const top = view.y * perWorld
        for (const bar of bars) {
          const at = `scale ${scale} dpr ${dpr}`
          expect(whole(bar.h), `${at} thickness ${bar.h}`).toBe(true)
          // Measured from the top of the visible rect, which is hardware row
          // zero, so a whole offset is a whole row.
          expect(whole(bar.y - top), `${at} top ${bar.y - top}`).toBe(true)
        }
      }
    }
  })

  it('spaces them evenly, so the period cannot drift', () => {
    for (const scale of SCALES) {
      for (const dpr of RATIOS) {
        const { bars } = draw({ scale, dpr })
        const first = bars[1].y - bars[0].y
        for (let i = 2; i < bars.length; i++) {
          expect(bars[i].y - bars[i - 1].y).toBeCloseTo(first, 9)
        }
        expect(whole(first)).toBe(true)
      }
    }
  })

  it('always leaves a gap between one bar and the next', () => {
    for (const scale of SCALES) {
      for (const dpr of RATIOS) {
        const { bars } = draw({ scale, dpr })
        expect(
          bars[1].y - bars[0].y,
          `scale ${scale} dpr ${dpr}`,
        ).toBeGreaterThan(bars[0].h)
      }
    }
  })
})

describe('apparent size', () => {
  it('holds one row in three however the camera is scaled', () => {
    // The bars are a property of the screen, so zooming the camera must not
    // change how dense they look.
    for (const scale of SCALES) {
      for (const dpr of RATIOS) {
        const { bars } = draw({ scale, dpr })
        const duty = bars[0].h / (bars[1].y - bars[0].y)
        expect(duty, `scale ${scale} dpr ${dpr}`).toBeCloseTo(1 / 3, 6)
      }
    }
  })

  it('covers what is on screen with as many bars as it has rows for', () => {
    // Zooming changes how much of the region is on screen and how many screen
    // pixels it takes up. What must not change is the spacing between bars, so
    // the count follows from the covered height and nothing else.
    for (const scale of SCALES) {
      const dpr = 2
      const { bars, view } = draw({ scale, dpr })
      const periodCssPx = (bars[1].y - bars[0].y) / dpr
      const coveredWorld =
        Math.min(REGION.y + REGION.height, view.y + view.height) -
        Math.max(REGION.y, view.y)
      // Give or take the bar on the closing edge, which the covered strip
      // either reaches or does not.
      const expected = coveredWorld / scale / periodCssPx
      expect(
        Math.abs(bars.length - expected),
        `scale ${scale}`,
      ).toBeLessThanOrEqual(1)
    }
  })

  it('is the same size in CSS pixels at every scale and ratio', () => {
    // The invariant the whole conversion exists for. However the camera is
    // zoomed and whatever the panel's ratio, a bar is two CSS pixels, which is
    // the same apparent size to somebody standing in front of the cabinet.
    for (const scale of SCALES) {
      for (const dpr of RATIOS) {
        const { bars } = draw({ scale, dpr })
        expect(bars[0].h / dpr, `scale ${scale} dpr ${dpr}`).toBeCloseTo(2, 6)
        expect(
          (bars[1].y - bars[0].y) / dpr,
          `scale ${scale} dpr ${dpr}`,
        ).toBeCloseTo(6, 6)
      }
    }
  })

  it('is thick enough to survive a resample', () => {
    // The whole point of the size. One hardware row has nothing left to give
    // when anything downstream rescales it.
    for (const scale of SCALES) {
      for (const dpr of RATIOS) {
        expect(draw({ scale, dpr }).bars[0].h).toBeGreaterThanOrEqual(2)
      }
    }
  })
})

describe('where it draws', () => {
  it('stays inside the game region', () => {
    const region: Bounds = { x: 200, y: 300, width: 800, height: 400 }
    const { bars } = draw({ region })
    expect(bars.length).toBeGreaterThan(0)
    for (const bar of bars) {
      expect(bar.x).toBeGreaterThanOrEqual(region.x)
      expect(bar.x + bar.w).toBeLessThanOrEqual(region.x + region.width)
      expect(bar.y).toBeGreaterThanOrEqual(region.y)
      expect(bar.y + bar.h).toBeLessThanOrEqual(region.y + region.height + 1e-9)
    }
  })

  it('holds still on screen while the camera moves under it', () => {
    // Phased from the visible rect rather than the world, so the field does not
    // crawl across itself during the launcher's pan.
    const at = (y: number): number[] => {
      const view: Bounds = { x: 0, y, width: 1920, height: 1080 }
      const { bars } = draw({
        view,
        region: { ...REGION, y: -2000, height: 6000 },
      })
      return bars.slice(0, 5).map((b) => b.y - y)
    }
    expect(at(37.4)).toEqual(at(0))
    expect(at(-812.9)).toEqual(at(0))
  })

  it('draws nothing when the region and the view do not meet', () => {
    const region: Bounds = { x: 5000, y: 5000, width: 10, height: 10 }
    expect(draw({ region }).bars).toHaveLength(0)
  })

  it('draws nothing for a camera with no height to fill', () => {
    // The only degenerate case the node has to guard. A zero device scale is
    // not one: `Gfx2D.deviceScale` contracts to return 1 rather than 0 when
    // there is no transform to read, and `snapSize` floors at one device pixel.
    expect(
      draw({ view: { x: 0, y: 0, width: 1920, height: 0 } }).bars,
    ).toHaveLength(0)
  })
})
