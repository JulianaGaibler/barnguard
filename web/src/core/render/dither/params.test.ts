import { describe, expect, it } from 'vitest'
import type { PostSourceInfo } from '@src/stargazer'
import {
  DEFAULT_DITHER,
  DITHER_PARAMS_BYTES,
  gridFor,
  packDitherParams,
  type DitherSettings,
} from './params'

function source(overrides: Partial<PostSourceInfo> = {}): PostSourceInfo {
  return {
    width: 100,
    height: 60,
    originX: 0,
    originY: 0,
    pxPerUnit: 1,
    unitOriginX: 0,
    unitOriginY: 0,
    ...overrides,
  }
}

describe('gridFor', () => {
  it('covers the surface with whole cells', () => {
    const grid = gridFor({ ...DEFAULT_DITHER, cellSize: 6 }, source())
    expect(grid.cellPx).toBe(6)
    expect(grid.firstColumn).toBe(0)
    expect(grid.columns).toBe(17)
    expect(grid.rows).toBe(10)
  })

  it('scales the cell by the units, and rounds it when snapping', () => {
    const settings = { ...DEFAULT_DITHER, cellSize: 5.4 }
    expect(gridFor(settings, source({ pxPerUnit: 2 })).cellPx).toBe(11)
    expect(gridFor({ ...settings, snap: false }, source()).cellPx).toBeCloseTo(
      5.4,
    )
  })

  it('fixes a screen grid to the canvas, whatever the surface corner', () => {
    const settings = {
      ...DEFAULT_DITHER,
      cellSize: 10,
      anchor: 'screen' as const,
    }
    const grid = gridFor(settings, source({ originX: 25, originY: 5 }))
    expect(grid.originX).toBe(-25)
    expect(grid.originY).toBe(-5)
    // Canvas column 2 starts at canvas x 20, which is surface x -5.
    expect(grid.firstColumn).toBe(2)
  })

  it('fixes a layer grid to the layer origin', () => {
    const settings = {
      ...DEFAULT_DITHER,
      cellSize: 10,
      anchor: 'layer' as const,
    }
    const grid = gridFor(settings, source({ unitOriginX: 33, unitOriginY: -4 }))
    expect(grid.originX).toBe(33)
    expect(grid.originY).toBe(-4)
    expect(grid.firstColumn).toBe(-4)
  })

  it('keeps a screen grid in place when the surface grows to the left', () => {
    const settings = {
      ...DEFAULT_DITHER,
      cellSize: 8,
      anchor: 'screen' as const,
    }
    const small = gridFor(settings, source({ originX: 40, width: 40 }))
    const grown = gridFor(settings, source({ originX: 16, width: 64 }))
    // A cell's index counts from the canvas corner, so cell 5 is at canvas
    // x 40 whichever surface draws it.
    const canvasX = (grid: typeof small, originX: number, cell: number) =>
      originX + grid.originX + cell * grid.cellPx
    expect(canvasX(small, 40, 5)).toBe(40)
    expect(canvasX(grown, 16, 5)).toBe(40)
    expect(small.firstColumn).toBe(5)
    expect(grown.firstColumn).toBe(2)
  })

  it('counts every pixel in a cell inside the grid', () => {
    for (const anchor of ['screen', 'layer'] as const) {
      for (const cellSize of [3, 5.5, 14]) {
        const settings = { ...DEFAULT_DITHER, cellSize, anchor, snap: false }
        const src = source({
          width: 97,
          height: 41,
          originX: 13,
          unitOriginX: 7.3,
          unitOriginY: -2.2,
          pxPerUnit: 1.5,
        })
        const grid = gridFor(settings, src)
        for (let x = 0; x < src.width; x++) {
          const column = Math.floor((x + 0.5 - grid.originX) / grid.cellPx)
          expect(column).toBeGreaterThanOrEqual(grid.firstColumn)
          expect(column).toBeLessThan(grid.firstColumn + grid.columns)
        }
        for (let y = 0; y < src.height; y++) {
          const row = Math.floor((y + 0.5 - grid.originY) / grid.cellPx)
          expect(row).toBeGreaterThanOrEqual(grid.firstRow)
          expect(row).toBeLessThan(grid.firstRow + grid.rows)
        }
      }
    }
  })

  it('takes a tap every two pixels, from one to eight a side', () => {
    const taps = (cellSize: number) =>
      gridFor({ ...DEFAULT_DITHER, cellSize }, source()).taps
    expect(taps(1)).toBe(1)
    expect(taps(6)).toBe(3)
    expect(taps(40)).toBe(8)
  })
})

describe('packDitherParams', () => {
  function pack(settings: Partial<DitherSettings> = {}, time = 0) {
    const merged = { ...DEFAULT_DITHER, ...settings }
    const src = source({ width: 200, height: 100 })
    const out = new Float32Array(DITHER_PARAMS_BYTES / 4)
    packDitherParams(merged, src, gridFor(merged, src), true, time, out)
    return out
  }

  it('fills the block the shader declares', () => {
    expect(DITHER_PARAMS_BYTES).toBe(8 * 16 + 2 * 16 + 16 * 16)
  })

  it('writes the frame, grid and mode vectors in order', () => {
    const out = pack({
      cellSize: 8,
      pattern: 'bayer2',
      dot: 'circle',
      palette: 'ramp',
      levels: 4,
    })
    expect([...out.slice(0, 4)]).toEqual([200, 100, 8, 1])
    expect([...out.slice(8, 12)]).toEqual([25, 13, 4, 0])
    expect([...out.slice(12, 16)]).toEqual([0, 2, 1, 4])
  })

  it('writes paper, ink and the palette as straight colors', () => {
    const out = pack({
      paper: '#ff0000',
      ink: 'rgba(0, 0, 255, 0.5)',
      colors: ['#00ff00', '#0000ff'],
    })
    expect([...out.slice(32, 36)]).toEqual([1, 0, 0, 1])
    expect([...out.slice(36, 40)]).toEqual([0, 0, 1, 0.5])
    expect([...out.slice(40, 48)]).toEqual([0, 1, 0, 1, 0, 0, 1, 1])
    expect(out[18]).toBe(2)
  })

  it('keeps at most 16 palette colors', () => {
    const out = pack({ colors: Array(20).fill('#ffffff') })
    expect(out[18]).toBe(16)
    expect(out.length).toBe(104)
  })

  it('writes a constant frame unless the pattern is temporal', () => {
    expect(pack({}, 3)[11]).toBe(0)
    expect(pack({ temporal: true }, 1)[11]).toBe(60)
  })

  it('measures the soft edge in device pixels', () => {
    const merged = { ...DEFAULT_DITHER, softness: 0.5 }
    const src = source({ pxPerUnit: 3 })
    const out = new Float32Array(DITHER_PARAMS_BYTES / 4)
    packDitherParams(merged, src, gridFor(merged, src), false, 0, out)
    expect(out[26]).toBeCloseTo(1.5)
    expect(out[3]).toBe(0)
  })
})
