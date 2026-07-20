/**
 * Board geometry: fit the 7x6 grid into the arcade game bounds, centered, with
 * a frame margin, and map between grid cells and world coordinates. Row 0 is
 * the bottom row (world y grows downward, so it has the largest y).
 */
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
  // Reserve half a cell of frame on every side (COLS+1 / ROWS+1 cells of room).
  const cell = Math.min(bounds.width / (COLS + 1), bounds.height / (ROWS + 1))
  const margin = cell * 0.5
  const gridW = cell * COLS
  const gridH = cell * ROWS
  const panelW = gridW + margin * 2
  const panelH = gridH + margin * 2
  const panelX = bounds.x + (bounds.width - panelW) / 2
  const panelY = bounds.y + (bounds.height - panelH) / 2
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
  l: BoardLayout,
  col: number,
  row: number,
): { x: number; y: number } {
  return {
    x: l.gridX + (col + 0.5) * l.cell,
    y: l.gridY + (ROWS - 1 - row + 0.5) * l.cell,
  }
}

/** World y just above the top row, where a dropping disc / preview starts. */
export function topEntryY(l: BoardLayout): number {
  return l.gridY - l.cell * 0.5
}

/** Column under a world x, clamped to the panel; null when x is outside it. */
export function columnAtX(l: BoardLayout, worldX: number): number | null {
  if (worldX < l.panelX || worldX > l.panelX + l.panelW) return null
  const col = Math.floor((worldX - l.gridX) / l.cell)
  return Math.max(0, Math.min(COLS - 1, col))
}
