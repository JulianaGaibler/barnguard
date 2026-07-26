/**
 * Board geometry: fit a square playfield (with a thick frame) into the arcade
 * game bounds and map between grid cells and world coordinates. Pure, so it is
 * testable without the engine. Row 0 is the top row (world y grows downward).
 *
 * Board placement (where the square(s) sit inside the game rect) is expressed
 * as a stargazer layout tree and evaluated headlessly: {@link buildSoloContent}
 * / {@link buildDualContent} build the tree, and {@link computeBoardBounds} /
 * {@link computeDualBoardBounds} run one measure/arrange pass and read back the
 * rect each `LayoutBuilder` reports. The grid mapping below stays plain math.
 */
import {
  Align,
  AspectRatio,
  BoxConstraints,
  Center,
  Column,
  edgeInsets,
  Expanded,
  LayoutBuilder,
  type MeasurableNode,
  Padding,
  type Rect,
  rectMargins,
  rectPointAt,
  Row,
  SizedBox,
} from '@src/stargazer'
import type { Bounds, CellRef, Orientation } from './types'
import { ANIM } from './tuning'

export interface FieldGeom {
  cols: number
  rows: number
  /** Outer board rect, including the black frame. */
  board: Bounds
  /** Frame thickness (world units). */
  border: number
  /** Top-left of the playfield (inside the frame). */
  x: number
  y: number
  /** Square cell size (world units). */
  cell: number
  /** Playfield extent = cols_cell × rows_cell. */
  width: number
  height: number
}

/** Fraction of the short side reserved as margin around the solo board. */
const PADDING_FRAC = 0.11
/** Two-player: small outer padding so the boards sit near the edges. */
const DUAL_OUTER_PAD_FRAC = 0.03
/** Two-player: minimum central gap between the boards (holds the LVL badge). */
const DUAL_MIN_GAP_FRAC = 0.26
/** Two-player landscape: top band reserved for hearts + scores. */
const DUAL_TOP_FRAC = 0.15
/** Two-player landscape: bottom band reserved for the progress readout. */
const DUAL_BOTTOM_FRAC = 0.1

/** Copy a reported layout rect into a fresh {@link Bounds}. */
function toBounds(r: Readonly<Rect>): Bounds {
  return { x: r.x, y: r.y, width: r.width, height: r.height }
}

/**
 * Measure and arrange `content` to fill `gameRect`; callbacks fire during
 * arrange.
 */
function runLayout(content: MeasurableNode, gameRect: Bounds): void {
  content.measure(BoxConstraints.tight(gameRect.width, gameRect.height))
  content.arrange(gameRect.x, gameRect.y, gameRect.width, gameRect.height)
}

/**
 * Layout tree for the one-player board: a square, centered, with a margin of
 * `PADDING_FRAC` of the short side. The `LayoutBuilder` reports the square's
 * world rect to `onBoard`.
 */
export function buildSoloContent(
  gameRect: Bounds,
  onBoard: (rect: Readonly<Rect>) => void,
): MeasurableNode {
  const pad = Math.min(gameRect.width, gameRect.height) * PADDING_FRAC
  return new Center({
    child: new Padding({
      insets: edgeInsets(pad),
      child: new AspectRatio({
        ratio: 1,
        child: new LayoutBuilder({ onLayout: onBoard }),
      }),
    }),
  })
}

/** A centered square that fits inside `gameRect` with breathing room. */
export function computeBoardBounds(gameRect: Bounds): Bounds {
  let board: Bounds = { x: 0, y: 0, width: 0, height: 0 }
  runLayout(
    buildSoloContent(gameRect, (r) => (board = toBounds(r))),
    gameRect,
  )
  return board
}

/** Center points + width of the gaps between a centered board and the edges. */
export function sideMargins(
  gameRect: Bounds,
  board: Bounds,
): { leftCenterX: number; rightCenterX: number; width: number } {
  const m = rectMargins(gameRect, board)
  return {
    leftCenterX: rectPointAt(m.left, 0.5, 0.5).x,
    rightCenterX: rectPointAt(m.right, 0.5, 0.5).x,
    width: Math.min(m.left.width, m.right.width),
  }
}

/**
 * Layout tree for the two-player boards: two squares pushed toward the outer
 * edges so a wide central gap is left for the shared LVL indicator. Side by
 * side in landscape (with top/bottom bands reserved for the HUD), stacked in
 * portrait. The two `LayoutBuilder`s report the board rects to `onA` / `onB`.
 */
export function buildDualContent(
  gameRect: Bounds,
  onA: (rect: Readonly<Rect>) => void,
  onB: (rect: Readonly<Rect>) => void,
): { content: MeasurableNode; orientation: 'row' | 'column' } {
  const minDim = Math.min(gameRect.width, gameRect.height)
  const outer = minDim * DUAL_OUTER_PAD_FRAC
  const minGap = minDim * DUAL_MIN_GAP_FRAC
  const boardA = new AspectRatio({
    ratio: 1,
    child: new LayoutBuilder({ onLayout: onA }),
  })
  const boardB = new AspectRatio({
    ratio: 1,
    child: new LayoutBuilder({ onLayout: onB }),
  })

  if (gameRect.width >= gameRect.height) {
    // Reserve top/bottom bands for the hearts+scores and the progress readout,
    // so the HUD never overlaps the boards at any aspect. Each board flushes to
    // its outer edge; the fixed gap between the two halves stays >= minGap.
    const topM = gameRect.height * DUAL_TOP_FRAC
    const botM = gameRect.height * DUAL_BOTTOM_FRAC
    const content = new Padding({
      insets: edgeInsets(topM, outer, botM, outer),
      child: new Row({
        crossAxisAlign: 'stretch',
        children: [
          new Expanded({
            child: new Align({ alignX: 'start', child: boardA }),
          }),
          new SizedBox({ width: minGap, height: minGap }),
          new Expanded({ child: new Align({ alignX: 'end', child: boardB }) }),
        ],
      }),
    })
    return { content, orientation: 'row' }
  }

  const content = new Padding({
    insets: edgeInsets(outer),
    child: new Column({
      crossAxisAlign: 'stretch',
      children: [
        new Expanded({ child: new Align({ alignY: 'start', child: boardA }) }),
        new SizedBox({ width: minGap, height: minGap }),
        new Expanded({ child: new Align({ alignY: 'end', child: boardB }) }),
      ],
    }),
  })
  return { content, orientation: 'column' }
}

/**
 * Two square boards for two-player, pushed toward the outer edges so a wide
 * central gap is left for the shared LVL indicator: side by side in landscape,
 * stacked in portrait.
 */
export function computeDualBoardBounds(gameRect: Bounds): {
  a: Bounds
  b: Bounds
  orientation: 'row' | 'column'
} {
  let a: Bounds = { x: 0, y: 0, width: 0, height: 0 }
  let b: Bounds = { x: 0, y: 0, width: 0, height: 0 }
  const { content, orientation } = buildDualContent(
    gameRect,
    (r) => (a = toBounds(r)),
    (r) => (b = toBounds(r)),
  )
  runLayout(content, gameRect)
  return { a, b, orientation }
}

/** Resolve the playfield geometry (frame, cell size, origin) for a board. */
export function computeFieldGeom(
  board: Bounds,
  cols: number,
  rows: number,
): FieldGeom {
  const side = Math.min(board.width, board.height)
  const border = side * ANIM.borderFrac
  const innerX = board.x + border
  const innerY = board.y + border
  const innerW = board.width - border * 2
  const innerH = board.height - border * 2
  const cell = Math.min(innerW / cols, innerH / rows)
  const width = cell * cols
  const height = cell * rows
  return {
    cols,
    rows,
    board,
    border,
    x: innerX + (innerW - width) / 2,
    y: innerY + (innerH - height) / 2,
    cell,
    width,
    height,
  }
}

/** World rect of a grid cell. */
export function cellRect(g: FieldGeom, col: number, row: number): Bounds {
  return {
    x: g.x + col * g.cell,
    y: g.y + row * g.cell,
    width: g.cell,
    height: g.cell,
  }
}

/** World-space center of a grid cell. */
export function cellCenter(
  g: FieldGeom,
  col: number,
  row: number,
): { x: number; y: number } {
  return { x: g.x + (col + 0.5) * g.cell, y: g.y + (row + 0.5) * g.cell }
}

/** Grid cell a world point falls in, or null when outside the playfield. */
export function cellAtWorld(
  g: FieldGeom,
  worldX: number,
  worldY: number,
): CellRef | null {
  const col = Math.floor((worldX - g.x) / g.cell)
  const row = Math.floor((worldY - g.y) / g.cell)
  if (col < 0 || col >= g.cols || row < 0 || row >= g.rows) return null
  return { col, row }
}

/** True when a world point lies within the playfield (used to route touches). */
export function containsWorld(
  g: FieldGeom,
  worldX: number,
  worldY: number,
): boolean {
  return (
    worldX >= g.x &&
    worldX < g.x + g.width &&
    worldY >= g.y &&
    worldY < g.y + g.height
  )
}

/**
 * Snap a world point to the grid cell where a wall should originate. Returns
 * the seed cell for a two-way wall; the wall occupies that whole row (for a
 * horizontal wall) or column (for a vertical wall), growing outward from it.
 */
export function seedCell(
  g: FieldGeom,
  worldX: number,
  worldY: number,
): CellRef {
  const col = clampInt(Math.floor((worldX - g.x) / g.cell), 0, g.cols - 1)
  const row = clampInt(Math.floor((worldY - g.y) / g.cell), 0, g.rows - 1)
  return { col, row }
}

/**
 * The line of cells a wall of `orientation` through `seed` would occupy across
 * the full field (before growth trims it at obstacles). Horizontal walls fill a
 * row; vertical walls fill a column.
 */
export function wallLine(
  g: FieldGeom,
  seed: CellRef,
  orientation: Orientation,
): CellRef[] {
  const out: CellRef[] = []
  if (orientation === 'horizontal') {
    for (let col = 0; col < g.cols; col++) out.push({ col, row: seed.row })
  } else {
    for (let row = 0; row < g.rows; row++) out.push({ col: seed.col, row })
  }
  return out
}

function clampInt(v: number, lo: number, hi: number): number {
  return v < lo ? lo : v > hi ? hi : v
}
