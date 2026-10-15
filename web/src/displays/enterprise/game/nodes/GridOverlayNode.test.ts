import { describe, expect, it } from 'vitest'
import type { BitmapMask, CameraView2D, Gfx2D } from '@src/stargazer'
import { GridOverlayNode } from './GridOverlayNode'
import { TUNING } from '../data/tuning'

/**
 * Build a fake `BitmapMask` that keeps only three cells at world positions `(0,
 * 0)`, `(100, 0)`, and `(300, 0)`. With `worldRect = { x: -50, y: -50, w: 400,
 * h: 100 }` and `cellSizeWorld = 100`, the grid membership scan visits four
 * candidate columns whose centres land at `(0, 100, 200, 300)` × `y = 0`. The
 * `contains` stub returns `true` for every column except `x ≈ 200`, so the
 * overlay ends up with exactly three kept cells in the order `[near, mid,
 * far]`.
 *
 * The outline `Path2D` is never invoked (no `draw` call in the tests) so a
 * plain `new Path2D()` stands in.
 */
function makeMask(): BitmapMask {
  // `imageData` is required by the interface (used by the GPU clip path)
  // but never touched here, the tests don't call `draw()`. A 1×1
  // transparent stub satisfies the type.
  const stubImageData = {
    data: new Uint8ClampedArray(4),
    width: 1,
    height: 1,
  } as unknown as ImageData
  return {
    worldRect: { x: -50, y: -50, width: 400, height: 100 },
    resolution: { w: 4, h: 1 },
    imageData: stubImageData,
    contains(x: number, _y: number): boolean {
      // Dead zone at [140, 260], wider than a single cell so the
      // constructor's 5-sample corner test (centre + 4 corners at
      // ±cellHalf) can't accidentally admit the x=200 cell via a
      // stray corner. Cells at x=0, 100, 300 stay, and x=200 drops.
      const rx = Math.round(x)
      return rx < 140 || rx > 260
    },
    dispose(): void {},
  }
}

function buildNode(): GridOverlayNode {
  return new GridOverlayNode({
    bounds: makeMask().worldRect,
    mask: makeMask(),
    cellSizeWorld: 100,
  })
}

/** Read pulse value i through the node's internal test seam. */
function readPulseValue(node: GridOverlayNode, i: number): number {
  return node._pulseValueAt(i)
}

/** A recording stand-in for the `Gfx2D` surface the node draws through. */
function recordingGfx(): { gfx: Gfx2D; quads: number[][] } {
  const quads: number[][] = []
  const gfx = {
    drawShaderQuad: (_q: unknown, x: number, y: number, w: number, h: number) =>
      quads.push([x, y, w, h]),
  } as unknown as Gfx2D
  return { gfx, quads }
}

describe('GridOverlayNode.pulseFrom', () => {
  it('keeps only the cells whose centre passes `mask.contains`', () => {
    const node = buildNode()
    expect(node.cellCount).toBe(3)
  })

  it('lights up the nearest cell first; farther ones still zero', () => {
    const node = buildNode()
    node.pulseFrom({ x: 0, y: 0 })

    // Wavefront delays at speed 400 wu/s: 0 -> 0, 100 -> 0.25 s, 300 -> 0.75 s.
    // Tick just past the near wavefront but before the mid one.
    node.onUpdate(0.05)

    // Near cell (0, 0) should be within its rise envelope
    // (localT = 0.05 s, rise = 0.12 s -> value ≈ (0.05 / 0.12) × peakScale).
    const nearValue = readPulseValue(node, 0)
    expect(nearValue).toBeGreaterThan(0)
    expect(nearValue).toBeLessThan(TUNING.wahlkreise.pulse.peakScale)

    // Mid (100, 0): wavefront delay 0.25 s, elapsed 0.05 s -> localT < 0 -> value 0.
    expect(readPulseValue(node, 1)).toBe(0)
    // Far (300, 0): same story, delay 0.75 s.
    expect(readPulseValue(node, 2)).toBe(0)
  })

  it('reset() zeros pulse + warn buffers and clears active slots', () => {
    const node = buildNode()
    node.pulseFrom({ x: 0, y: 0 })
    node.onUpdate(0.1)
    expect(readPulseValue(node, 0)).toBeGreaterThan(0)

    node.reset()

    expect(readPulseValue(node, 0)).toBe(0)
    expect(readPulseValue(node, 1)).toBe(0)
    expect(readPulseValue(node, 2)).toBe(0)

    // After reset, a subsequent tick shouldn't revive the pulse, every
    // slot should be inactive.
    node.onUpdate(0.1)
    expect(readPulseValue(node, 0)).toBe(0)
  })
})

describe('GridOverlayNode grid layout', () => {
  it('keeps every cell of the bounds when there is no mask', () => {
    const node = new GridOverlayNode({
      bounds: { x: 0, y: 0, width: 300, height: 200 },
      mask: null,
      cellSizeWorld: 100,
    })
    expect(node.cellCount).toBe(6)
  })

  it('rounds a partial cell up so the bounds stay covered', () => {
    const node = new GridOverlayNode({
      bounds: { x: 0, y: 0, width: 250, height: 100 },
      mask: null,
      cellSizeWorld: 100,
    })
    expect(node.cellCount).toBe(3)
  })
})

describe('GridOverlayNode drawing', () => {
  const camera = {} as CameraView2D

  it('draws nothing while every cell is dark', () => {
    const node = buildNode()
    const { gfx, quads } = recordingGfx()
    node.onUpdate(0.016)
    node.draw(gfx, camera)
    expect(quads.length).toBe(0)
  })

  it('draws one quad over the whole grid while any cell is lit', () => {
    const node = buildNode()
    const { gfx, quads } = recordingGfx()
    node.pulseFrom({ x: 0, y: 0 })
    node.onUpdate(0.05)
    node.draw(gfx, camera)
    expect(quads).toEqual([[-50, -50, 400, 100]])
  })

  it('packs the pulse into the second channel of the cell texel', () => {
    const node = buildNode()
    node.pulseFrom({ x: 0, y: 0 })
    node.onUpdate(0.05)
    const [warn, pulse] = node._texelAt(0)
    expect(warn).toBe(0)
    expect(pulse).toBeGreaterThan(0)
    expect(node._texelAt(1)).toEqual([0, 0])
  })

  it('goes quiet again once the pulse has passed, and after reset', () => {
    const node = buildNode()
    const { gfx, quads } = recordingGfx()
    node.pulseFrom({ x: 0, y: 0 })
    node.onUpdate(0.05)
    node.reset()
    node.draw(gfx, camera)
    expect(quads.length).toBe(0)
    expect(node._texelAt(0)).toEqual([0, 0])
  })
})
