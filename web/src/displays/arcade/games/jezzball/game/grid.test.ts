import { describe, expect, it } from 'vitest'
import {
  captureEmptyRegions,
  createGrid,
  filledCount,
  takenPct,
  markWall,
  cellAt,
  wallSpans,
  type Grid,
} from './grid'
import { CELL_FILLED, CELL_OPEN, CELL_WALL, type CellRef } from './types'

/** Fill a full column with walls (a vertical divider). */
function wallColumn(g: Grid, col: number): void {
  for (let row = 0; row < g.rows; row++) markWall(g, col, row)
}

describe('jezzball grid', () => {
  it('starts empty at 0%', () => {
    const g = createGrid(20, 20)
    expect(filledCount(g)).toBe(0)
    expect(takenPct(g)).toBe(0)
  })

  it('does not capture a region that still holds a ball', () => {
    const g = createGrid(10, 10)
    // No walls: the whole board is one open region containing a ball.
    const filled = captureEmptyRegions(g, [{ col: 5, row: 5 }])
    expect(filled).toHaveLength(0)
    expect(filledCount(g)).toBe(0)
  })

  it('captures only the ball-free side after a divider', () => {
    const g = createGrid(11, 10)
    // Vertical wall at col 5 splits the board; a ball sits on the left side.
    wallColumn(g, 5)
    const ball: CellRef = { col: 2, row: 4 }
    const filled = captureEmptyRegions(g, [ball])

    // Right side (cols 6..10) × 10 rows = 50 cells captured; left stays open.
    expect(filled).toHaveLength(50)
    expect(cellAt(g, 8, 4)).toBe(CELL_FILLED)
    expect(cellAt(g, 2, 4)).toBe(CELL_OPEN)
    // The wall column itself is untouched.
    expect(cellAt(g, 5, 4)).toBe(CELL_WALL)
  })

  it('captures both sides when the ball is walled off elsewhere', () => {
    const g = createGrid(11, 10)
    wallColumn(g, 5)
    // Ball on neither side (its cell is inside the wall column — treated as
    // occupying no open region), so both open regions are ball-free.
    const filled = captureEmptyRegions(g, [{ col: 5, row: 0 }])
    // Left (cols 0..4 = 50) + right (cols 6..10 = 50) = 100 open cells.
    expect(filled).toHaveLength(100)
    expect(filledCount(g)).toBe(100)
  })

  it('counts captured cells and the player wall toward the taken surface', () => {
    const g = createGrid(10, 10) // 100 cells
    wallColumn(g, 5) // 10 wall cells
    captureEmptyRegions(g, [{ col: 1, row: 1 }]) // fills right side cols 6..9 = 40
    expect(filledCount(g)).toBe(40) // captured region only
    // Taken surface = the 40 captured cells + the 10-cell wall column.
    expect(takenPct(g)).toBeCloseTo(50, 5)
  })

  it('counts a wall toward the taken surface before any region fills', () => {
    const g = createGrid(10, 10)
    wallColumn(g, 5) // 10 of 100 cells
    expect(filledCount(g)).toBe(0) // nothing captured yet
    expect(takenPct(g)).toBeCloseTo(10, 5) // the wall still counts
  })

  it('is idempotent — a second pass with the same ball changes nothing', () => {
    const g = createGrid(11, 10)
    wallColumn(g, 5)
    const ball: CellRef = { col: 2, row: 4 }
    captureEmptyRegions(g, [ball])
    const before = filledCount(g)
    const again = captureEmptyRegions(g, [ball])
    expect(again).toHaveLength(0)
    expect(filledCount(g)).toBe(before)
  })

  it('splits a wall into whole-cell spans on the seed boundary', () => {
    const g = createGrid(11, 10)
    // Horizontal wall on row 4, seeded at column 5 in a clear row.
    const s = wallSpans(g, 'horizontal', { col: 5, row: 4 })
    // A owns [0..5] (seed cell included), B owns [6..10]; no cell is shared.
    expect(s.a).toEqual([0, 5])
    expect(s.b).toEqual([6, 10])
  })

  it('reconnects cleanly after a broken half is refilled', () => {
    const g = createGrid(11, 10)
    // First wall's right half solidified: it owns cells [6..10] on row 4; its
    // left half was destroyed, so the seed cell (5) and left stay OPEN.
    for (let c = 6; c <= 10; c++) g.cells[4 * g.cols + c] = CELL_WALL

    // Build the rest from column 2: A owns [0..2], B grows right until it hits
    // the existing wall — owning [3..5], i.e. right up to the survivor's edge.
    const s = wallSpans(g, 'horizontal', { col: 2, row: 4 })
    expect(s.a).toEqual([0, 2])
    expect(s.b).toEqual([3, 5])
    // Together with the existing [6..10] the whole row is covered, no gap.
  })

  it('has no B span when the seed sits against a wall on the high side', () => {
    const g = createGrid(11, 10)
    for (let c = 6; c <= 10; c++) g.cells[4 * g.cols + c] = CELL_WALL
    const s = wallSpans(g, 'horizontal', { col: 5, row: 4 })
    expect(s.a).toEqual([0, 5])
    expect(s.b).toBeNull()
  })

  it('leaves a small pocket open when it traps a ball', () => {
    const g = createGrid(10, 10)
    // Box off a 1x1 pocket at (0,0): wall the cells that seal it.
    markWall(g, 1, 0)
    markWall(g, 0, 1)
    markWall(g, 1, 1)
    const filled = captureEmptyRegions(g, [{ col: 0, row: 0 }])
    // The pocket stays open (has the ball); the large region is ball-free and
    // fills.
    expect(cellAt(g, 0, 0)).toBe(CELL_OPEN)
    expect(filled.length).toBeGreaterThan(0)
    expect(cellAt(g, 5, 5)).toBe(CELL_FILLED)
  })
})
