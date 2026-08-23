/**
 * Board geometry: fit the playfield (and the four arrow bars around it) into
 * the arcade game bounds, and map between cells and world coordinates.
 *
 * Placement is expressed as a stargazer layout tree and evaluated headlessly:
 * {@link buildSoloContent} / {@link buildDualContent} build the tree, and the
 * `compute*` wrappers run one measure/arrange pass and read back the rect each
 * `LayoutBuilder` reports. The cell mapping below is plain math.
 *
 * The tree reports a SLOT, not the plate: the arrow bars live outside the plate
 * but inside the square the layout hands out, so {@link computeBoardGeom} insets
 * the plate from the slot by one bar plus its band. One function does that for
 * solo and for each versus half, so the bars sit identically in both.
 */
import {
  Align,
  BoxConstraints,
  Center,
  Column,
  edgeInsets,
  Expanded,
  LayoutBuilder,
  type MeasurableNode,
  Padding,
  type Rect,
  Row,
  SizedBox,
  rect,
  rectInflate,
} from '@src/stargazer'
import { type Bounds, type Direction, SIZE } from './types'
import { BEVEL } from './tuning'

/** Arrow bar thickness, as a fraction of the slot's side. */
const BAR_FRAC = 0.075
/** Clear space between a bar and the plate, as a fraction of the bar. */
const BAND_FRAC = 0.35
/** Gap between cells, as a fraction of the cell. */
const GAP_FRAC = 0.09
/**
 * Board side, capped as a fraction of the region's short side. The booth screen
 * is big enough that filling it costs the player their overview of the board,
 * so the board stays comfortably smaller than the space available.
 */
const SOLO_MAX_SIDE_FRAC = 0.66
const DUAL_MAX_SIDE_FRAC = 0.6

/** Solo: band above the board reserved for the score readouts. */
const SOLO_TOP_FRAC = 0.12
/** Solo: band below the board, so the plate is not bottom-heavy. */
const SOLO_BOTTOM_FRAC = 0.06
/** Padding from the region edges. */
const OUTER_PAD_FRAC = 0.03
/** Versus landscape: band above the boards for the two score readouts. */
const DUAL_TOP_FRAC = 0.13
/** Versus landscape: band below the boards. */
const DUAL_BOTTOM_FRAC = 0.06
/**
 * Versus: gap between the two halves. Much narrower than JezzBall's, which
 * reserves a central badge; here the space only has to separate two boards that
 * already carry their own arrow bars.
 */
const DUAL_GAP_FRAC = 0.1

/** Everything a board needs to draw itself and to be hit-tested. */
export interface BoardGeom {
  /** The square the layout handed out, plate plus arrow bars. */
  slot: Bounds
  /** The slab the wells are cut into. */
  plate: Bounds
  /** Padding inside the plate, equal to the gap between cells. */
  pad: number
  gap: number
  /** Side of one cell. */
  cell: number
  /** Corner radius shared by tiles, wells, plate and bars. */
  radius: number
  /** Top-left of cell 0. */
  origin: { x: number; y: number }
  /** Bar thickness. */
  bar: number
  arrows: Record<Direction, Bounds>
}

function toBounds(r: Readonly<Rect>): Bounds {
  return { x: r.x, y: r.y, width: r.width, height: r.height }
}

/** Measure and arrange `content` to fill `gameRect`. Callbacks fire on arrange. */
function runLayout(content: MeasurableNode, gameRect: Bounds): void {
  content.measure(BoxConstraints.tight(gameRect.width, gameRect.height))
  content.arrange(gameRect.x, gameRect.y, gameRect.width, gameRect.height)
}

/**
 * Layout tree for one player: a centered square under a band reserved for the
 * score. The `LayoutBuilder` reports the square to `onSlot`.
 */
function buildSoloContent(
  gameRect: Bounds,
  onSlot: (rect: Readonly<Rect>) => void,
): MeasurableNode {
  const outer = Math.min(gameRect.width, gameRect.height) * OUTER_PAD_FRAC
  const top = gameRect.height * SOLO_TOP_FRAC
  const bottom = gameRect.height * SOLO_BOTTOM_FRAC
  const side = squareSide(
    gameRect.width - outer * 2,
    gameRect.height - top - bottom,
    Math.min(gameRect.width, gameRect.height) * SOLO_MAX_SIDE_FRAC,
  )
  return new Padding({
    insets: edgeInsets(top, outer, bottom, outer),
    child: new Center({
      child: new SizedBox({
        width: side,
        height: side,
        child: new LayoutBuilder({ onLayout: onSlot }),
      }),
    }),
  })
}

/** The largest square that fits the space available, under `max`. */
function squareSide(availW: number, availH: number, max: number): number {
  return Math.max(1, Math.min(availW, availH, max))
}

/** The square slot for a one-player board. */
export function computeSoloSlot(gameRect: Bounds): Bounds {
  let slot: Bounds = { x: 0, y: 0, width: 0, height: 0 }
  runLayout(
    buildSoloContent(gameRect, (r) => (slot = toBounds(r))),
    gameRect,
  )
  return slot
}

/**
 * Layout tree for two players: two squares pushed to the outer edges with a gap
 * between them, side by side in landscape and stacked in portrait. Portrait is
 * kept because the arcade region adopts the canvas aspect, so a tall window is
 * a real case rather than a hypothetical one.
 */
function buildDualContent(
  gameRect: Bounds,
  onA: (rect: Readonly<Rect>) => void,
  onB: (rect: Readonly<Rect>) => void,
): { content: MeasurableNode; orientation: 'row' | 'column' } {
  const minDim = Math.min(gameRect.width, gameRect.height)
  const outer = minDim * OUTER_PAD_FRAC
  const gap = minDim * DUAL_GAP_FRAC
  const landscape = gameRect.width >= gameRect.height
  const side = landscape
    ? squareSide(
        (gameRect.width - outer * 2 - gap) / 2,
        gameRect.height * (1 - DUAL_TOP_FRAC - DUAL_BOTTOM_FRAC),
        minDim * DUAL_MAX_SIDE_FRAC,
      )
    : squareSide(
        gameRect.width - outer * 2,
        (gameRect.height - outer * 2 - gap) / 2,
        minDim * DUAL_MAX_SIDE_FRAC,
      )
  const slotA = new SizedBox({
    width: side,
    height: side,
    child: new LayoutBuilder({ onLayout: onA }),
  })
  const slotB = new SizedBox({
    width: side,
    height: side,
    child: new LayoutBuilder({ onLayout: onB }),
  })

  if (landscape) {
    const content = new Padding({
      insets: edgeInsets(
        gameRect.height * DUAL_TOP_FRAC,
        outer,
        gameRect.height * DUAL_BOTTOM_FRAC,
        outer,
      ),
      child: new Row({
        crossAxisAlign: 'stretch',
        children: [
          new Expanded({ child: new Align({ alignX: 'end', child: slotA }) }),
          new SizedBox({ width: gap, height: gap }),
          new Expanded({ child: new Align({ alignX: 'start', child: slotB }) }),
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
        new Expanded({ child: new Align({ alignY: 'end', child: slotA }) }),
        new SizedBox({ width: gap, height: gap }),
        new Expanded({ child: new Align({ alignY: 'start', child: slotB }) }),
      ],
    }),
  })
  return { content, orientation: 'column' }
}

/** The two square slots for a versus match. */
export function computeDualSlots(gameRect: Bounds): {
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

/**
 * Resolve a slot into the plate, the cell grid and the four arrow bars.
 *
 * The bars deliberately stop at the plate's edges instead of wrapping into the
 * corners. Closing the ring would overlap two bars' hit rects at each corner,
 * and which one won would then be decided silently by paint order.
 */
export function computeBoardGeom(slot: Bounds): BoardGeom {
  const side = Math.min(slot.width, slot.height)
  const bar = side * BAR_FRAC
  const band = bar * BAND_FRAC
  const inset = bar + band
  const plate: Bounds = rectInflate(rect(), slot, -inset)
  // plate = 4 cells + 3 gaps + 2 pads, with pad and gap both GAP_FRAC of a
  // cell. A tile's extrusion comes out of its own square, so nothing overhangs.
  const cell = plate.width / (SIZE + GAP_FRAC * (SIZE + 1))
  const gap = cell * GAP_FRAC
  const pad = gap

  return {
    slot,
    plate,
    pad,
    gap,
    cell,
    radius: cell * BEVEL.radiusFrac,
    origin: { x: plate.x + pad, y: plate.y + pad },
    bar,
    arrows: {
      up: {
        x: plate.x,
        y: plate.y - band - bar,
        width: plate.width,
        height: bar,
      },
      down: {
        x: plate.x,
        y: plate.y + plate.height + band,
        width: plate.width,
        height: bar,
      },
      left: {
        x: plate.x - band - bar,
        y: plate.y,
        width: bar,
        height: plate.height,
      },
      right: {
        x: plate.x + plate.width + band,
        y: plate.y,
        width: bar,
        height: plate.height,
      },
    },
  }
}

/** World rect of a cell. */
export function cellRect(g: BoardGeom, index: number): Bounds {
  const col = index % SIZE
  const row = Math.floor(index / SIZE)
  return {
    x: g.origin.x + col * (g.cell + g.gap),
    y: g.origin.y + row * (g.cell + g.gap),
    width: g.cell,
    height: g.cell,
  }
}

/** World center of a cell. */
export function cellCenter(
  g: BoardGeom,
  index: number,
): { x: number; y: number } {
  const r = cellRect(g, index)
  return { x: r.x + r.width / 2, y: r.y + r.height / 2 }
}

/** Whether a world point is on the plate. */
export function containsWorld(g: BoardGeom, x: number, y: number): boolean {
  return (
    x >= g.plate.x &&
    x <= g.plate.x + g.plate.width &&
    y >= g.plate.y &&
    y <= g.plate.y + g.plate.height
  )
}
