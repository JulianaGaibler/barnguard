/**
 * Turn the logical grid's solid cells (walls + captured regions) into a small
 * set of world-space rectangles for static physics colliders, plus the four
 * playfield-border rects balls bounce off. Pure and tested.
 *
 * Solid cells are merged with greedy meshing — maximal horizontal runs per row,
 * then vertically merging runs with an identical column span — so a straight
 * wall or a rectangular captured region becomes a single rect instead of many
 * unit boxes. Balls only ever occupy open space, so internal faces of a merged
 * rect never matter; only its outer faces (bordering open cells) are hit.
 */
import { clamp } from '@src/stargazer'
import { CELL_FILLED, CELL_WALL, type Bounds } from './types'
import type { Grid } from './grid'
import type { FieldGeom } from './layout'

/** An inclusive cell-range rectangle: columns c0..c1, rows r0..r1. */
export interface CellRect {
  c0: number
  r0: number
  c1: number
  r1: number
}

function isSolid(g: Grid, col: number, row: number): boolean {
  const v = g.cells[row * g.cols + col]
  return v === CELL_WALL || v === CELL_FILLED
}

/** Greedy-mesh solid cells into a minimal-ish set of inclusive cell rects. */
export function mergeSolidCells(g: Grid): CellRect[] {
  const { cols, rows } = g
  const rects: CellRect[] = []
  // Span key ("c0:c1") → index of the still-open rect from the previous row.
  let prev = new Map<string, number>()

  for (let r = 0; r < rows; r++) {
    const cur = new Map<string, number>()
    let c = 0
    while (c < cols) {
      if (!isSolid(g, c, r)) {
        c++
        continue
      }
      const c0 = c
      while (c < cols && isSolid(g, c, r)) c++
      const c1 = c - 1
      const key = `${c0}:${c1}`
      const above = prev.get(key)
      if (above !== undefined && rects[above].r1 === r - 1) {
        rects[above].r1 = r
        cur.set(key, above)
      } else {
        rects.push({ c0, r0: r, c1, r1: r })
        cur.set(key, rects.length - 1)
      }
    }
    prev = cur
  }
  return rects
}

/** A cell-range rect in world coordinates via the field geometry. */
export function cellRectToWorld(geom: FieldGeom, cr: CellRect): Bounds {
  return {
    x: geom.x + cr.c0 * geom.cell,
    y: geom.y + cr.r0 * geom.cell,
    width: (cr.c1 - cr.c0 + 1) * geom.cell,
    height: (cr.r1 - cr.r0 + 1) * geom.cell,
  }
}

/** The four border rects enclosing the playfield (balls bounce off these). */
export function borderRects(geom: FieldGeom): Bounds[] {
  const t = geom.cell
  const { x, y, width, height } = geom
  return [
    { x: x - t, y: y - t, width: width + 2 * t, height: t }, // top
    { x: x - t, y: y + height, width: width + 2 * t, height: t }, // bottom
    { x: x - t, y, width: t, height }, // left
    { x: x + width, y, width: t, height }, // right
  ]
}

/** All static-collider rects for the current grid: border + merged solids. */
export function buildColliderRects(g: Grid, geom: FieldGeom): Bounds[] {
  const out = borderRects(geom)
  for (const cr of mergeSolidCells(g)) out.push(cellRectToWorld(geom, cr))
  return out
}

/**
 * True when the circle at `(cx, cy, r)` overlaps the axis-aligned `rect`.
 * Shared by the board's ball-vs-growing-wall hit test and the tutorial demos.
 */
export function circleHitsRect(
  cx: number,
  cy: number,
  r: number,
  rect: Bounds,
): boolean {
  if (rect.width <= 0 || rect.height <= 0) return false
  const nx = clamp(cx, rect.x, rect.x + rect.width)
  const ny = clamp(cy, rect.y, rect.y + rect.height)
  const dx = cx - nx
  const dy = cy - ny
  return dx * dx + dy * dy <= r * r
}
