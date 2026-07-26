import { describe, expect, it } from 'vitest'
import {
  cellAtWorld,
  cellCenter,
  computeBoardBounds,
  computeDualBoardBounds,
  computeFieldGeom,
  containsWorld,
  seedCell,
  wallLine,
} from './layout'
import type { Bounds } from './types'

const LANDSCAPE: Bounds = { x: 0, y: 0, width: 1920, height: 1080 }
const PORTRAIT: Bounds = { x: 0, y: 0, width: 1080, height: 1920 }

describe('jezzball layout', () => {
  it('fits a centered square board', () => {
    const b = computeBoardBounds(LANDSCAPE)
    expect(b.width).toBeCloseTo(b.height, 5) // square
    // Centered in the game rect.
    expect(b.x + b.width / 2).toBeCloseTo(960, 5)
    expect(b.y + b.height / 2).toBeCloseTo(540, 5)
    // Fits with padding.
    expect(b.height).toBeLessThan(1080)
  })

  it('maps world points to cells and back', () => {
    const geom = computeFieldGeom(computeBoardBounds(LANDSCAPE), 20, 20)
    for (const [col, row] of [
      [0, 0],
      [7, 3],
      [19, 19],
    ] as const) {
      const c = cellCenter(geom, col, row)
      expect(cellAtWorld(geom, c.x, c.y)).toEqual({ col, row })
    }
  })

  it('returns null for points outside the playfield', () => {
    const geom = computeFieldGeom(computeBoardBounds(LANDSCAPE), 20, 20)
    expect(cellAtWorld(geom, geom.x - 1, geom.y - 1)).toBeNull()
    expect(cellAtWorld(geom, geom.x + geom.width + 1, geom.y)).toBeNull()
    expect(containsWorld(geom, geom.x - 1, geom.y)).toBe(false)
    expect(containsWorld(geom, geom.x + 1, geom.y + 1)).toBe(true)
  })

  it('sizes cells to the frame-inset field', () => {
    const board = computeBoardBounds(LANDSCAPE)
    const geom = computeFieldGeom(board, 20, 20)
    expect(geom.cell * geom.cols).toBeCloseTo(geom.width, 5)
    expect(geom.width).toBeLessThan(board.width) // inset by the frame
    expect(geom.x).toBeGreaterThan(board.x)
  })

  it('lays two equal, non-overlapping boards side by side in landscape', () => {
    const { a, b, orientation } = computeDualBoardBounds(LANDSCAPE)
    expect(orientation).toBe('row')
    expect(a.width).toBeCloseTo(a.height, 5)
    expect(a.width).toBeCloseTo(b.width, 5)
    expect(a.x + a.width).toBeLessThan(b.x) // a gap between them
    // Symmetric about the game-rect center.
    expect(a.x + a.width / 2 - 960).toBeCloseTo(960 - (b.x + b.width / 2), 5)
  })

  it('stacks two boards vertically in portrait', () => {
    const { a, b, orientation } = computeDualBoardBounds(PORTRAIT)
    expect(orientation).toBe('column')
    expect(a.width).toBeCloseTo(b.width, 5)
    expect(a.x).toBeCloseTo(b.x, 5)
    expect(a.y + a.height).toBeLessThan(b.y)
  })

  it('clamps a seed cell into the grid', () => {
    const geom = computeFieldGeom(computeBoardBounds(LANDSCAPE), 20, 20)
    expect(seedCell(geom, geom.x - 500, geom.y - 500)).toEqual({
      col: 0,
      row: 0,
    })
    expect(
      seedCell(geom, geom.x + geom.width + 500, geom.y + geom.height + 500),
    ).toEqual({ col: 19, row: 19 })
  })

  it('builds full-span wall lines', () => {
    const geom = computeFieldGeom(computeBoardBounds(LANDSCAPE), 20, 20)
    const horiz = wallLine(geom, { col: 4, row: 7 }, 'horizontal')
    expect(horiz).toHaveLength(20)
    expect(horiz.every((c) => c.row === 7)).toBe(true)
    const vert = wallLine(geom, { col: 4, row: 7 }, 'vertical')
    expect(vert).toHaveLength(20)
    expect(vert.every((c) => c.col === 4)).toBe(true)
  })
})
