/**
 * Where the boards and the color buttons sit inside the arcade game region, and
 * how a grid cell maps to world coordinates.
 *
 * Placement is written as a stargazer layout tree and evaluated headlessly:
 * each `build*Content` assembles the tree, a single measure and arrange pass
 * runs it, and a `LayoutBuilder` per slot reports back the world rect it was
 * given. That keeps the arrangement declarative and testable with no engine, no
 * canvas and no camera, while the cell mapping below stays plain arithmetic.
 *
 * Every mode arranges a board above the swatch row that drives it. The contest
 * shares one board between two rows, one per player.
 */
import {
  AspectRatio,
  Box,
  BoxConstraints,
  Column,
  edgeInsets,
  Expanded,
  LayoutBuilder,
  type MeasurableNode,
  Padding,
  type Rect,
  rectMargins,
  Row,
  rect,
  rectInflate,
} from '@src/stargazer'
import { GEOM } from './tuning'
import type { Bounds, CellRef } from './types'

/** One player's area: the readout band, the board, and the row that drives it. */
export interface Slot {
  /** Band above the board, for the move counter. */
  hud: Bounds
  board: Bounds
  swatches: Bounds
}

/** Margin around everything, as a fraction of the region's short side. */
const OUTER_FRAC = 0.05
/**
 * Height of a swatch row, as a fraction of the region's short side.
 *
 * The buttons are square and centred rather than stretched across the row, so
 * this is the button size too. Small on purpose: the booth screen is large, and
 * a row of full-width buttons ate a quarter of it while still being a far
 * bigger target than a finger needs.
 */
const SWATCH_FRAC = 0.075
/** Band above the board for the move counter, same basis. */
const HUD_FRAC = 0.075
/** Gap between the stacked pieces, same basis. */
const GAP_FRAC = 0.025
/** Gap between the two halves of a two-player arrangement. */
const SPLIT_FRAC = 0.05

const EMPTY: Bounds = { x: 0, y: 0, width: 0, height: 0 }

const toBounds = (r: Readonly<Rect>): Bounds => ({
  x: r.x,
  y: r.y,
  width: r.width,
  height: r.height,
})

/** Measure and arrange `content` to exactly fill `region`. */
function runLayout(content: MeasurableNode, region: Bounds): void {
  content.measure(BoxConstraints.tight(region.width, region.height))
  content.arrange(region.x, region.y, region.width, region.height)
}

/**
 * A readout band, a square board, and a swatch row, stacked.
 *
 * The bands top and bottom are fixed heights and the board takes whatever is
 * left, squared off and centred by `AspectRatio` on its own. Reserving the top
 * band in the layout rather than placing the counter above the board by hand is
 * what keeps it on screen: the board would otherwise start at the very top of
 * the padded region and leave nothing to hang a readout in.
 */
function boardWithSwatches(
  short: number,
  onHud: (r: Readonly<Rect>) => void,
  onBoard: (r: Readonly<Rect>) => void,
  onSwatches: (r: Readonly<Rect>) => void,
): MeasurableNode {
  return new Column({
    crossAxisAlign: 'stretch',
    gap: short * GAP_FRAC,
    children: [
      new Box({
        height: short * HUD_FRAC,
        child: new LayoutBuilder({ onLayout: onHud }),
      }),
      new Expanded({
        child: new AspectRatio({
          ratio: 1,
          child: new LayoutBuilder({ onLayout: onBoard }),
        }),
      }),
      new Box({
        height: short * SWATCH_FRAC,
        child: new LayoutBuilder({ onLayout: onSwatches }),
      }),
    ],
  })
}

/** One board filling the region, for the solo puzzle. */
function buildSoloContent(
  region: Bounds,
  onSlot: (slot: Slot) => void,
): MeasurableNode {
  const short = Math.min(region.width, region.height)
  let hud = EMPTY
  let board = EMPTY
  let swatches = EMPTY
  const report = (): void => onSlot({ hud, board, swatches })
  return new Padding({
    insets: edgeInsets(short * OUTER_FRAC),
    child: boardWithSwatches(
      short,
      (r) => {
        hud = toBounds(r)
        report()
      },
      (r) => {
        board = toBounds(r)
        report()
      },
      (r) => {
        swatches = toBounds(r)
        report()
      },
    ),
  })
}

/** A centered square board with its swatch row, for the solo puzzle. */
export function computeSoloSlot(region: Bounds): Slot {
  let slot: Slot = { hud: EMPTY, board: EMPTY, swatches: EMPTY }
  runLayout(
    buildSoloContent(region, (s) => (slot = s)),
    region,
  )
  return slot
}

/**
 * Two independent board-and-row halves, for the race.
 *
 * Side by side in landscape so two people standing shoulder to shoulder each
 * face their own half, stacked in portrait where there is no width to split.
 */
function buildRaceContent(
  region: Bounds,
  onA: (slot: Slot) => void,
  onB: (slot: Slot) => void,
): MeasurableNode {
  const short = Math.min(region.width, region.height)
  const outer = short * OUTER_FRAC
  const split = short * SPLIT_FRAC
  const landscape = region.width >= region.height

  const half = (report: (slot: Slot) => void): MeasurableNode => {
    let hud = EMPTY
    let board = EMPTY
    let swatches = EMPTY
    const emit = (): void => report({ hud, board, swatches })
    // A split half is scored against the short side of the whole region, not of
    // the half, so both halves size their bands identically at any aspect.
    return boardWithSwatches(
      short,
      (r) => {
        hud = toBounds(r)
        emit()
      },
      (r) => {
        board = toBounds(r)
        emit()
      },
      (r) => {
        swatches = toBounds(r)
        emit()
      },
    )
  }

  const children = [
    new Expanded({ child: half(onA) }),
    new Expanded({ child: half(onB) }),
  ]
  const opts = { crossAxisAlign: 'stretch' as const, gap: split, children }

  return new Padding({
    insets: edgeInsets(outer),
    child: landscape ? new Row(opts) : new Column(opts),
  })
}

/** Two halves for the race, one per player. */
export function computeRaceSlots(region: Bounds): { a: Slot; b: Slot } {
  let a: Slot = { hud: EMPTY, board: EMPTY, swatches: EMPTY }
  let b: Slot = { hud: EMPTY, board: EMPTY, swatches: EMPTY }
  runLayout(
    buildRaceContent(
      region,
      (s) => (a = s),
      (s) => (b = s),
    ),
    region,
  )
  return { a, b }
}

/**
 * One shared board with a swatch row on either side of it, for the contest.
 *
 * Both rows sit below the board, split left and right, so each player reaches
 * their own without crossing the other. The board keeps the whole width above
 * them, since both players read the same grid.
 */
function buildTerritoryContent(
  region: Bounds,
  onLayout: (t: TerritorySlots) => void,
): MeasurableNode {
  const short = Math.min(region.width, region.height)
  const swatchH = short * SWATCH_FRAC
  const gap = short * GAP_FRAC
  const split = short * SPLIT_FRAC

  let board = EMPTY
  let a = EMPTY
  let b = EMPTY
  const emit = (): void => onLayout({ board, swatchesA: a, swatchesB: b })

  return new Padding({
    insets: edgeInsets(short * OUTER_FRAC),
    child: new Column({
      crossAxisAlign: 'stretch',
      gap,
      children: [
        new Expanded({
          child: new AspectRatio({
            ratio: 1,
            child: new LayoutBuilder({
              onLayout: (r) => {
                board = toBounds(r)
                emit()
              },
            }),
          }),
        }),
        new Box({
          height: swatchH,
          child: new Row({
            crossAxisAlign: 'stretch',
            gap: split,
            children: [
              new Expanded({
                child: new LayoutBuilder({
                  onLayout: (r) => {
                    a = toBounds(r)
                    emit()
                  },
                }),
              }),
              new Expanded({
                child: new LayoutBuilder({
                  onLayout: (r) => {
                    b = toBounds(r)
                    emit()
                  },
                }),
              }),
            ],
          }),
        }),
      ],
    }),
  })
}

/** The shared board and the two swatch rows under it. */
export interface TerritorySlots {
  board: Bounds
  swatchesA: Bounds
  swatchesB: Bounds
}

/** One shared board with a swatch row per player beneath it. */
export function computeTerritorySlots(region: Bounds): TerritorySlots {
  let slots: TerritorySlots = {
    board: EMPTY,
    swatchesA: EMPTY,
    swatchesB: EMPTY,
  }
  runLayout(
    buildTerritoryContent(region, (t) => (slots = t)),
    region,
  )
  return slots
}

/** Resolved cell geometry for one board rect. */
export interface FieldGeom {
  cols: number
  rows: number
  /** Outer board rect, the well included. */
  board: Bounds
  /** Distance from one cell's left edge to the next. */
  pitch: number
  /** Drawn cell size, which is the pitch less the gap. */
  cell: number
  /** Top-left of the first cell. */
  x: number
  y: number
  /** Extent of the cells, pitch times count. */
  width: number
  height: number
}

/** Fit `cols` by `rows` cells into `board`, centered, with a padded well. */
export function computeFieldGeom(
  board: Bounds,
  cols: number,
  rows: number,
): FieldGeom {
  // The well padding is itself a fraction of the pitch, so it is folded into
  // the divisor rather than subtracted after: solving for pitch directly avoids
  // a second pass that would leave the cells slightly off-center.
  const pad = 2 * GEOM.wellPadFrac
  const pitch = Math.min(
    board.width / (cols + pad),
    board.height / (rows + pad),
  )
  const width = pitch * cols
  const height = pitch * rows
  return {
    cols,
    rows,
    board,
    pitch,
    cell: pitch * (1 - GEOM.cellGapFrac),
    x: board.x + (board.width - width) / 2,
    y: board.y + (board.height - height) / 2,
    width,
    height,
  }
}

/** The well rect: the padded recess the cells sit in. */
export function wellRect(g: FieldGeom): Bounds {
  return rectInflate(rect(), g, g.pitch * GEOM.wellPadFrac)
}

/** Top-left of a cell's drawn square, gap already taken off. */
export function cellOrigin(
  g: FieldGeom,
  col: number,
  row: number,
): { x: number; y: number } {
  const inset = (g.pitch - g.cell) / 2
  return { x: g.x + col * g.pitch + inset, y: g.y + row * g.pitch + inset }
}

/** World center of a cell. */
export function cellCenter(
  g: FieldGeom,
  col: number,
  row: number,
): { x: number; y: number } {
  return {
    x: g.x + (col + 0.5) * g.pitch,
    y: g.y + (row + 0.5) * g.pitch,
  }
}

/** The cell a world point falls in, or null when it is outside the grid. */
export function cellAtWorld(
  g: FieldGeom,
  worldX: number,
  worldY: number,
): CellRef | null {
  const col = Math.floor((worldX - g.x) / g.pitch)
  const row = Math.floor((worldY - g.y) / g.pitch)
  if (col < 0 || col >= g.cols || row < 0 || row >= g.rows) return null
  return { col, row }
}

/**
 * The color index of the cell under a world point, or null outside the grid.
 *
 * Backs tapping a tile as a shortcut for pressing that color's button. Kept out
 * of the board node so the mapping is testable without a stage. `colors` is the
 * board's own color array.
 */
export function colorAtWorld(
  g: FieldGeom,
  colors: Uint8Array,
  worldX: number,
  worldY: number,
): number | null {
  const cell = cellAtWorld(g, worldX, worldY)
  if (!cell) return null
  return colors[cell.row * g.cols + cell.col] ?? null
}

/**
 * Geometry of one swatch in a row of `count`, laid out left to right.
 *
 * Buttons are square and the group is centred in the row rather than stretched
 * across it. A stretched row on a booth-sized screen produces buttons far wider
 * than any finger needs, and a compact group of squares reads as a palette,
 * which is what it is. The size only shrinks below the row height if the count
 * genuinely will not fit.
 */
export function swatchRect(row: Bounds, count: number, index: number): Bounds {
  const gap = row.height * GEOM.swatchGapFrac
  const span = row.width - gap * (count - 1)
  const size = Math.min(row.height, span / count)
  const total = size * count + gap * (count - 1)
  const startX = row.x + (row.width - total) / 2
  return {
    x: startX + index * (size + gap),
    y: row.y + (row.height - size) / 2,
    width: size,
    height: size,
  }
}

/**
 * The empty strips either side of a centred board.
 *
 * The contest hangs each player's tally in their own strip, vertically centred
 * against the shared board, so neither reads as belonging to the other.
 */
export function sideMargins(
  region: Bounds,
  board: Bounds,
): { left: Bounds; right: Bounds } {
  const m = rectMargins(region, board)
  return {
    left: {
      x: m.left.x,
      y: m.left.y,
      width: m.left.width,
      height: m.left.height,
    },
    right: {
      x: m.right.x,
      y: m.right.y,
      width: m.right.width,
      height: m.right.height,
    },
  }
}
