/**
 * Board geometry: fit the 7x6 grid into the arcade game bounds, centered, with
 * a frame margin, and map between grid cells and world coordinates. Row 0 is
 * the bottom row (world y grows downward, so it has the largest y).
 */
import { alignWithin } from '@src/stargazer'
import { COLS, ROWS } from './board'

export interface Bounds {
  x: number
  y: number
  width: number
  height: number
}

export interface BoardLayout {
  /** Rounded panel rect (the frame the holes are cut from). */
  panelX: number
  panelY: number
  panelW: number
  panelH: number
  /** Top-left of the grid area inside the panel. */
  gridX: number
  gridY: number
  /** Square cell size. */
  cell: number
}

export function computeLayout(bounds: Bounds): BoardLayout {
  // Fit the grid with breathing room: 1.5 cells of slack on each axis leaves the
  // panel at ~85% of the view height and ~55% of its width, so the side tabs and
  // the top drop pill have room around it.
  const cell = Math.min(
    bounds.width / (COLS + 1.5),
    bounds.height / (ROWS + 1.5),
  )
  const margin = cell * 0.5
  const gridW = cell * COLS
  const gridH = cell * ROWS
  const panelW = gridW + margin * 2
  const panelH = gridH + margin * 2
  const { x: panelX, y: panelY } = alignWithin(
    bounds,
    panelW,
    panelH,
    'center',
    'center',
  )
  return {
    panelX,
    panelY,
    panelW,
    panelH,
    gridX: panelX + margin,
    gridY: panelY + margin,
    cell,
  }
}

/** World-space center of a grid cell (row 0 = bottom). */
export function cellCenter(
  layout: BoardLayout,
  col: number,
  row: number,
): { x: number; y: number } {
  return {
    x: layout.gridX + (col + 0.5) * layout.cell,
    y: layout.gridY + (ROWS - 1 - row + 0.5) * layout.cell,
  }
}

/** World y just above the top row, where a dropping disc / preview starts. */
export function topEntryY(layout: BoardLayout): number {
  return layout.gridY - layout.cell * 0.5
}

/** Column under a world x, clamped to the panel; null when x is outside it. */
export function columnAtX(layout: BoardLayout, worldX: number): number | null {
  if (worldX < layout.panelX || worldX > layout.panelX + layout.panelW)
    return null
  const col = Math.floor((worldX - layout.gridX) / layout.cell)
  return Math.max(0, Math.min(COLS - 1, col))
}
