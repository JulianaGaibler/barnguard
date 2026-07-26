import { describe, expect, it } from 'vitest'
import {
  borderRects,
  buildColliderRects,
  mergeSolidCells,
  type CellRect,
} from './colliders'
import { createGrid, markWall, setCell, type Grid } from './grid'
import { CELL_FILLED } from './types'
import { computeBoardBounds, computeFieldGeom } from './layout'

function wallColumn(g: Grid, col: number): void {
  for (let row = 0; row < g.rows; row++) markWall(g, col, row)
}
function wallRow(g: Grid, row: number): void {
  for (let col = 0; col < g.cols; col++) markWall(g, col, row)
}
function fillBlock(
  g: Grid,
  c0: number,
  r0: number,
  c1: number,
  r1: number,
): void {
  for (let r = r0; r <= r1; r++)
    for (let c = c0; c <= c1; c++) setCell(g, c, r, CELL_FILLED)
}

function has(rects: CellRect[], want: CellRect): boolean {
  return rects.some(
    (r) =>
      r.c0 === want.c0 &&
      r.r0 === want.r0 &&
      r.c1 === want.c1 &&
      r.r1 === want.r1,
  )
}

describe('jezzball colliders — greedy meshing', () => {
  it('emits nothing for an empty grid', () => {
    expect(mergeSolidCells(createGrid(10, 10))).toHaveLength(0)
  })

  it('merges a vertical wall into one tall rect', () => {
    const g = createGrid(10, 10)
    wallColumn(g, 3)
    const rects = mergeSolidCells(g)
    expect(rects).toHaveLength(1)
    expect(has(rects, { c0: 3, r0: 0, c1: 3, r1: 9 })).toBe(true)
  })

  it('merges a horizontal wall into one wide rect', () => {
    const g = createGrid(10, 10)
    wallRow(g, 4)
    const rects = mergeSolidCells(g)
    expect(rects).toHaveLength(1)
    expect(has(rects, { c0: 0, r0: 4, c1: 9, r1: 4 })).toBe(true)
  })

  it('merges a rectangular captured region into one rect', () => {
    const g = createGrid(10, 10)
    fillBlock(g, 5, 3, 8, 6)
    const rects = mergeSolidCells(g)
    expect(rects).toHaveLength(1)
    expect(has(rects, { c0: 5, r0: 3, c1: 8, r1: 6 })).toBe(true)
  })

  it('keeps disjoint walls as separate rects', () => {
    const g = createGrid(10, 10)
    wallColumn(g, 2)
    wallColumn(g, 7)
    expect(mergeSolidCells(g)).toHaveLength(2)
  })

  it('decomposes a plus shape into three rects', () => {
    const g = createGrid(10, 10)
    wallRow(g, 5)
    wallColumn(g, 5)
    // Column runs above (rows 0..4) and below (rows 6..9) the full row, plus
    // the full row itself.
    const rects = mergeSolidCells(g)
    expect(rects).toHaveLength(3)
    expect(has(rects, { c0: 5, r0: 0, c1: 5, r1: 4 })).toBe(true)
    expect(has(rects, { c0: 0, r0: 5, c1: 9, r1: 5 })).toBe(true)
    expect(has(rects, { c0: 5, r0: 6, c1: 5, r1: 9 })).toBe(true)
  })

  it('produces four border rects enclosing the field', () => {
    const geom = computeFieldGeom(
      computeBoardBounds({ x: 0, y: 0, width: 1920, height: 1080 }),
      20,
      20,
    )
    const b = borderRects(geom)
    expect(b).toHaveLength(4)
    // Left border sits left of the field; right border sits at its right edge.
    expect(b[2].x).toBeLessThan(geom.x)
    expect(b[3].x).toBeCloseTo(geom.x + geom.width, 5)
  })

  it('combines border and solid rects in world space', () => {
    const geom = computeFieldGeom(
      computeBoardBounds({ x: 0, y: 0, width: 1920, height: 1080 }),
      20,
      20,
    )
    const g = createGrid(20, 20)
    wallColumn(g, 10)
    const rects = buildColliderRects(g, geom)
    // 4 border + 1 merged wall.
    expect(rects).toHaveLength(5)
    // The wall rect is a thin, tall world rect.
    const wall = rects[4]
    expect(wall.width).toBeCloseTo(geom.cell, 5)
    expect(wall.height).toBeCloseTo(geom.height, 5)
  })
})
