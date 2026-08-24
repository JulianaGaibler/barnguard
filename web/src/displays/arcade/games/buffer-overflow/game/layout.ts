/**
 * Where everything sits: the window, the buffer, the two panes flanking it, the
 * framed input band, and the bars that close the top and bottom.
 *
 * Plain arithmetic rather than a headless stargazer layout tree, which is what
 * Flood It and 2048 use. Those two have genuinely flexible boards. This one is
 * a fixed column inside a fixed one- or two-way split, with no flex to resolve,
 * so a tree would be indirection over a page of division.
 *
 * Three facts shape all of it:
 *
 * The region is never smaller than 1920 by 1080. `gameVisibleRect` fits the
 * region into the canvas aspect-preserving, so a narrow canvas holds the width
 * at 1920 and grows the height, and a wide one grows the width.
 *
 * Height binds, not width. A ten-by-twenty buffer is twice as tall as it is
 * wide, so the vertical budget decides the cell size and the flanks are left
 * over. Widening them buys nothing, which is why they carry the panes.
 *
 * Surplus is margin, not stretch. Everything is measured inside one centred
 * window with a maximum size, so an ultrawide canvas gets a terminal window on
 * a desktop rather than panes flung to the edges with a void in the middle.
 *
 * Everything resolves in one pass through {@link computeLayout}, because the
 * pieces are not independent: the cell decides the pane width, the pane width
 * decides whether the gutter fits, and the pane height decides how much of the
 * log and the queue survive.
 */
import { COLS, VISIBLE_ROWS } from './board'
import { RULES } from './tuning'
import type { Bounds } from './types'
import { clamp } from '@src/stargazer'

/** Margin left and right of the whole region, as a fraction of its short side. */
const OUTER_PAD_FRAC = 0.028
/**
 * Margin above and below, same fraction.
 *
 * Tighter than the sides, because the two are not competing for the same thing.
 * Width is what the composition is short of, so the side margin is real
 * restraint. Height is what it has spare, so a matching margin up here would
 * only be spending what is already going begging.
 */
const OUTER_PAD_Y_FRAC = 0.018
/** Gap between the two halves in a race, same fraction. */
const SPLIT_GAP_FRAC = 0.035
/**
 * Height of the input band, as a fraction of the region's short side.
 *
 * Small, because the buffer itself is a full second input surface: tap to turn,
 * two fingers to turn back, drag to slide, pull to hurry, flick to drop. The
 * caps are the fallback rather than the only way in, so they can afford to be a
 * band rather than a keyboard.
 */
const CONTROLS_FRAC = 0.075
/** Clear space between the buffer and the input band. */
const BAND_GAP_FRAC = 0.014
/**
 * The most that gap will open to, in cells.
 *
 * The composition is bound by its width, so at most aspects it finishes shorter
 * than the region and floats with a wide margin above and below. The surplus
 * goes here rather than staying outside the frame: a window that reaches for
 * the edges reads as the screen's layout, where one floating in the middle of
 * it reads as a layout that did not fit.
 *
 * It lands between the board and the buttons on purpose. That is the seam
 * between reading and acting, and the one place on the seat where more air is
 * worth something. Capped, because past a couple of cells it stops being a seam
 * and starts being a hole.
 */
const BAND_GAP_MAX_CELLS = 2.2
/** Gap between the buffer and whatever is beside it, in cells. */
const FLANK_GAP_CELLS = 0.55

/**
 * Largest a cell may get.
 *
 * A tall canvas hands out far more vertical than a twenty-row buffer needs, and
 * an uncapped buffer would grow until the player lost the overview that makes
 * the game readable. Both reference games cap for the same reason.
 *
 * It also decides how much width is left for everything beside the board. The
 * flanks are measured in cells, so a buffer that takes every spare pixel of
 * height takes the ambient columns with it: shortening the input band once grew
 * the cell by a tenth and cost those columns nearly half their width.
 */
const MAX_CELL = 36

/** A pane wide enough for a log line, and no wider. */
const PANE_MAX_CELLS = 11
/** An ambient telemetry column, solo only. */
const ASIDE_MAX_CELLS = 7.5
/** Below this a meter is a stub rather than a reading, so the column goes. */
const ASIDE_MIN_CELLS = 4.5
/**
 * Air between an ambient column and the pane beside it.
 *
 * Tighter than the gap around the buffer. Two windows on a dashboard sit closer
 * to each other than either sits to the thing the dashboard is about.
 */
const ASIDE_GAP_CELLS = 0.4
/** A pane must still hold a four-wide preview and its padding. */
const PANE_MIN_CELLS = 4.6
/**
 * The margin either side of the buffer, in cells.
 *
 * Reserved on both sides even though only the left carries addresses, because
 * the buffer has to be dead centre. Centring the buffer plus its gutter as one
 * block puts the board itself off centre by half a gutter, which is small
 * enough to look like a mistake rather than a choice. The right side is not
 * empty: the row ruler's numbers sit in it.
 *
 * Sized for six characters and no more. It was nearly twice this and the space
 * read as a gap rather than as a margin.
 */
const GUTTER_CELLS = 1.5
/** The gutter labels the buffer's rows, so it sits close to them. */
const GUTTER_GAP_CELLS = 0.3
/** How far the buffer's frame stands off the cells, in cells. */
const FRAME_PAD_CELLS = 0.3

/**
 * Which optional columns a seat is carrying.
 *
 * Decided once, from the region, before the window is sized, and then used by
 * everything downstream. This is the window's one hard rule: a cap sized for a
 * column that a later check drops leaves that column's room behind as void
 * beside a pane, which is invisible in a passing test and obvious on a screen.
 * Both of these columns have been that bug already.
 */
interface SeatChoices {
  /** The hex address column against the buffer. */
  gutter: boolean
  /** The two ambient telemetry columns, solo only. */
  asides: boolean
}

/**
 * One seat's whole composition, in cells, for the columns it is carrying.
 *
 * The sum of the parts rather than a round number, so the cap always lands
 * exactly where the content stops.
 */
function seatCells(c: SeatChoices): number {
  return (
    COLS +
    (c.gutter ? (GUTTER_CELLS + GUTTER_GAP_CELLS) * 2 : 0) +
    (PANE_MAX_CELLS + FLANK_GAP_CELLS) * 2 +
    (c.asides ? (ASIDE_MAX_CELLS + ASIDE_GAP_CELLS) * 2 : 0)
  )
}

/** Below this the gutter cannot fit without eating into a pane, so it goes. */
const WITH_GUTTER_MIN_CELLS =
  COLS +
  (GUTTER_CELLS + GUTTER_GAP_CELLS) * 2 +
  (PANE_MIN_CELLS + FLANK_GAP_CELLS) * 2

/**
 * What this region will actually carry.
 *
 * The gutter needs both the width and enough of a cell to set eight hex
 * characters at the type floor. The asides need whatever is left once the rest
 * of the composition has had its full width, because decoration never takes
 * from a readout.
 */
function seatChoices(
  slotWidth: number,
  players: 1 | 2,
  cell: number,
  floor: number,
): SeatChoices {
  // Six characters of address, at roughly six tenths of the type size each.
  // Tied to what the column has to say rather than to a round number, so
  // narrowing the column later does not silently take the check with it.
  const gutter =
    slotWidth >= cell * WITH_GUTTER_MIN_CELLS &&
    cell * GUTTER_CELLS >= floor * 3.8
  const asides =
    players === 1 &&
    slotWidth >=
      cell *
        (seatCells({ gutter, asides: false }) +
          (ASIDE_MIN_CELLS + ASIDE_GAP_CELLS) * 2)
  return { gutter, asides }
}

/**
 * Below this the log stops reading as a log and starts reading as a stray
 * flashing line, so it is given three rows or none.
 */
const LOG_MIN_LINES = 3
/** Past this it is history rather than feedback, and it eats the pane. */
const LOG_MAX_LINES = 8

/**
 * Text floors, in CSS pixels.
 *
 * Not world units, and the difference is the whole point. The region is a fixed
 * 1920 by 1080 minimum in world units but an arbitrary number of CSS pixels, so
 * a floor of eleven world units is five CSS pixels on a half-width viewport,
 * which is the condition anyone developing with dev tools docked is in.
 */
const MIN_TEXT_CSS_PX = 11
const MIN_VALUE_CSS_PX = 16

/** Section heights inside a pane, in cells. */
const SEC = {
  bank: 3.4,
  bankCap: 1.4,
  clock: 1.8,
  readout: 1.9,
  /** The level carries a progress meter under its value. */
  levelReadout: 2.7,
  queueTitle: 0.9,
  queueRow: 1.5,
  /** Space a divider claims, including the air either side of it. */
  divider: 0.5,
} as const

/** The smallest type the chrome is allowed to shrink to, in world units. */
export function textFloor(cssPxInWorld: number): number {
  return MIN_TEXT_CSS_PX * cssPxInWorld
}

/** The smallest a readout's value is allowed to shrink to, in world units. */
export function valueFloor(cssPxInWorld: number): number {
  return MIN_VALUE_CSS_PX * cssPxInWorld
}

/**
 * Which chrome survives at this size.
 *
 * The order things are given up in is fixed and is the whole contract: ticks,
 * then the gutter, then the status line's fields, then the log, then the
 * header's detail, then the queue's depth. The buffer, the input band and the
 * score are never dropped. A terminal out of room hides panes rather than
 * clipping them.
 */
export interface Chrome {
  /** Row marks on the buffer's right rule. */
  ticks: boolean
  /** The hex address column. */
  gutter: boolean
  /** Rows the event log shows. Zero hides the section. */
  logLines: number
  /** Previews the queue shows, never below one. */
  queueCount: number
  /** Telemetry fields on the status line. Zero hides the line. */
  statusFields: number
  /** The header's mode, players and uptime fields, beyond its title. */
  headerDetail: boolean
}

/** Everything one seat needs placed. */
export interface SeatGeometry {
  /** The field pieces fall into, exactly `COLS` by `VISIBLE_ROWS` cells. */
  buffer: Bounds
  /**
   * The rule around it, standing off the cells.
   *
   * Both panes match this rather than the cells, so the three frames share a
   * top and a bottom edge. A row of boxes that nearly line up is the difference
   * between a terminal and a mock of one.
   */
  bufferFrame: Bounds
  cell: number
  /** The hex address column. Zero-sized when the ladder has dropped it. */
  gutter: Bounds
  /** The two full-height pane frames. */
  statePane: Bounds
  statsPane: Bounds
  /**
   * Ambient telemetry columns outside them. Zero-sized in a race.
   *
   * The left column is two stacked windows and the right is one, which is what
   * a real dashboard looks like: panes sized to their contents rather than a
   * symmetrical pair of boxes.
   */
  asideLeftTop: Bounds
  asideLeftBottom: Bounds
  asideRight: Bounds
  /** Sections inside `statePane`. */
  hold: Bounds
  holdButton: Bounds
  log: Bounds
  /** Countdown's clock. Zero-sized in Uptime, which never mounts one. */
  clock: Bounds
  /** Sections inside `statsPane`. */
  next: Bounds
  score: Bounds
  level: Bounds
  lines: Bounds
  /** The framed input band. */
  controls: Bounds
  /** Inside its frame, which is what `computeControlRects` takes. */
  controlsBody: Bounds
}

export interface LayoutInput {
  /** The game region's visible world rect, never the design constants. */
  region: Bounds
  players: 1 | 2
  /** World units in one CSS pixel, from `region.cssPxInWorld`. */
  cssPxInWorld: number
  /** Countdown reserves a clock section. */
  clock: boolean
  /** World units the header keeps clear on its right, for the pause cap. */
  rightInset: number
}

export interface Layout {
  /** The centred content box everything else is measured inside. */
  window: Bounds
  header: Bounds
  /** Zero-sized when the ladder has dropped it. */
  status: Bounds
  chrome: Chrome
  seats: SeatGeometry[]
}

const ZERO: Bounds = { x: 0, y: 0, width: 0, height: 0 }

/**
 * The centred content box, at a size it is told.
 *
 * Sizing is the caller's job because the content's own size is only known once
 * a cell has been resolved, and the cell comes from the region. See
 * {@link computeLayout}, which resolves the two in order.
 */
function computeWindow(
  region: Bounds,
  maxWidth: number,
  maxHeight: number,
): Bounds {
  const short = Math.min(region.width, region.height)
  const padX = short * OUTER_PAD_FRAC
  const padY = short * OUTER_PAD_Y_FRAC
  const innerX = region.x + padX
  const innerY = region.y + padY
  const innerW = region.width - padX * 2
  const innerH = region.height - padY * 2
  const width = Math.min(innerW, maxWidth)
  const height = Math.min(innerH, maxHeight)
  return {
    x: innerX + (innerW - width) / 2,
    y: innerY + (innerH - height) / 2,
    width,
    height,
  }
}

/** The window this region would give a composition of `cells` cells per seat. */
function windowFor(
  region: Bounds,
  players: 1 | 2,
  cell: number,
  contentH: number,
  choices: SeatChoices,
): Bounds {
  const short = Math.min(region.width, region.height)
  const gap = players === 2 ? short * SPLIT_GAP_FRAC : 0
  return computeWindow(
    region,
    cell * seatCells(choices) * players + gap,
    contentH,
  )
}

/** One seat's share of the seat area. */
function computeSlots(area: Bounds, players: 1 | 2, gap: number): Bounds[] {
  if (players === 1) return [area]
  // Side by side at every aspect, unlike Flood It and 2048, which stack in
  // portrait. Their boards are square, and a 1:2 buffer stacked would get a
  // quarter of the height and be unplayable, which the guaranteed width means
  // it never has to be.
  const half = (area.width - gap) / 2
  return [
    { x: area.x, y: area.y, width: half, height: area.height },
    { x: area.x + half + gap, y: area.y, width: half, height: area.height },
  ]
}

/** The vertical a seat's own stack needs: buffer, gap, input band. */
function seatStackHeight(cell: number, short: number, bandGap: number): number {
  return (
    cell * (VISIBLE_ROWS + FRAME_PAD_CELLS * 2) +
    bandGap +
    short * CONTROLS_FRAC
  )
}

/**
 * The band gap, opened up by whatever vertical the composition leaves behind.
 *
 * See {@link BAND_GAP_MAX_CELLS} for why the surplus goes here.
 */
function resolveBandGap(
  region: Bounds,
  short: number,
  cell: number,
  fixedH: number,
): number {
  const base = short * BAND_GAP_FRAC
  const innerH = region.height - short * OUTER_PAD_Y_FRAC * 2
  const surplus = innerH - (fixedH + base)
  return Math.min(base + Math.max(0, surplus), cell * BAND_GAP_MAX_CELLS)
}

/** The window with the two bars taken off it. */
function insetBars(
  win: Bounds,
  barH: number,
  statusH: number,
  barGap: number,
): Bounds {
  const top = win.y + barH + barGap
  const bottom = win.y + win.height - statusH - barGap
  return {
    x: win.x,
    y: top,
    width: win.width,
    height: Math.max(0, bottom - top),
  }
}

/**
 * Resolve the window, the bars, the surviving chrome and both seats.
 *
 * Two passes, because the window and the cell each want to be derived from the
 * other. The first sizes a cell against everything the region offers, the
 * second builds the window to fit exactly that cell's composition and places
 * the seats inside it. The cell is carried across rather than recomputed, so
 * the second pass cannot drift by a rounding error into a smaller board.
 */
export function computeLayout(input: LayoutInput): Layout {
  const { region, players, cssPxInWorld, clock, rightInset } = input
  const short = Math.min(region.width, region.height)
  const floor = textFloor(cssPxInWorld)

  const barH = Math.max(floor * 1.9, short * 0.024)
  const barGap = short * 0.012
  const statusH = barH * 0.85
  const barsH = barH + statusH + barGap * 2
  const splitGap = players === 2 ? short * SPLIT_GAP_FRAC : 0

  const probe = computeWindow(region, Infinity, Infinity)
  const probeSlots = computeSlots(
    insetBars(probe, barH, statusH, barGap),
    players,
    splitGap,
  )
  const cell = measureSeat(probeSlots[0], short, clock, {
    gutter: false,
    asides: false,
  }).cell
  const choices = seatChoices(probeSlots[0].width, players, cell, floor)

  // Everything above the band gap is settled by now, so what the gap has to
  // work with is whatever the region has left over.
  const bandGap = resolveBandGap(
    region,
    short,
    cell,
    cell * (VISIBLE_ROWS + FRAME_PAD_CELLS * 2) + short * CONTROLS_FRAC + barsH,
  )
  const win = windowFor(
    region,
    players,
    cell,
    seatStackHeight(cell, short, bandGap) + barsH,
    choices,
  )
  const header: Bounds = {
    x: win.x,
    y: win.y,
    // Stops short of the pause cap rather than running under it, which reads
    // better than an inverse bar with a button sitting on top of it.
    width: Math.max(
      0,
      Math.min(win.width, region.x + region.width - rightInset - win.x),
    ),
    height: barH,
  }

  const area = insetBars(win, barH, statusH, barGap)
  const slots = computeSlots(area, players, splitGap)
  const chrome = resolveChrome(
    measureSeat(slots[0], short, clock, choices, cell, bandGap),
    header.width,
    floor,
  )
  const seats = slots.map((slot) =>
    placeSeat(
      measureSeat(slot, short, clock, choices, cell, bandGap),
      chrome,
      clock,
    ),
  )

  const status: Bounds =
    chrome.statusFields > 0
      ? {
          x: win.x,
          y: win.y + win.height - statusH,
          width: win.width,
          height: statusH,
        }
      : ZERO

  return { window: win, header, status, chrome, seats }
}

/** What a seat's size implies, before the ladder has had a say. */
interface SeatMetrics {
  slot: Bounds
  cell: number
  buffer: Bounds
  bufferFrame: Bounds
  /** Zero-sized when the seat is too narrow to carry one. */
  gutter: Bounds
  flankGap: number
  asideGap: number
  paneW: number
  /** Zero when a race, or when the flank cannot hold a readable column. */
  asideW: number
  paneTop: number
  paneH: number
  controls: Bounds
  controlsBody: Bounds
  /** Vertical left in the left pane once the fixed sections are placed. */
  logRoom: number
  /** Vertical left in the right pane above the readouts. */
  queueRoom: number
}

function measureSeat(
  slot: Bounds,
  short: number,
  clock: boolean,
  choices: SeatChoices,
  forcedCell?: number,
  forcedBandGap?: number,
): SeatMetrics {
  const controlsH = short * CONTROLS_FRAC
  const bandGap = forcedBandGap ?? short * BAND_GAP_FRAC

  // Height is the binding constraint, but a very wide, very short window could
  // still run out of room sideways, so the cell honours both. Both flanks have
  // to hold a pane at its minimum, plus the gap on either side of the buffer.
  const availH = slot.height - controlsH - bandGap
  const byHeight = availH / (VISIBLE_ROWS + FRAME_PAD_CELLS * 2)
  const byWidth = slot.width / (COLS + (PANE_MIN_CELLS + FLANK_GAP_CELLS) * 2)
  const cell = forcedCell ?? clamp(Math.min(byHeight, byWidth), 1, MAX_CELL)

  const bufW = cell * COLS
  const bufH = cell * VISIBLE_ROWS
  const framePadV = cell * FRAME_PAD_CELLS
  const stackH = bufH + framePadV * 2 + bandGap + controlsH
  const top = slot.y + (slot.height - stackH) / 2 + framePadV

  // Reserved on both sides, so the buffer lands exactly on the slot's centre
  // line. The left margin holds the addresses and the right holds the ruler's
  // numbers, and either way the board is centred.
  const gutterOn = choices.gutter
  const gutterW = gutterOn ? cell * GUTTER_CELLS : 0
  const gutterGap = gutterOn ? cell * GUTTER_GAP_CELLS : 0
  const bufX = slot.x + (slot.width - bufW) / 2
  const buffer: Bounds = { x: bufX, y: top, width: bufW, height: bufH }
  const gutter: Bounds = gutterOn
    ? { x: bufX - gutterGap - gutterW, y: top, width: gutterW, height: bufH }
    : ZERO
  const blockX = bufX - gutterGap - gutterW

  // The flank is shared between the pane that plays the game and the column
  // that only decorates, and the pane is served to its cap first. Reserving for
  // the aside up front would let decoration squeeze a readout, which is the
  // wrong way round at every size.
  const flankGap = cell * FLANK_GAP_CELLS
  const flankW = Math.max(0, blockX - slot.x)
  const paneW = clamp(flankW - flankGap, 0, cell * PANE_MAX_CELLS)
  const asideGap = cell * ASIDE_GAP_CELLS
  const spare = flankW - flankGap - asideGap - paneW
  const asideW =
    choices.asides && spare >= cell * ASIDE_MIN_CELLS
      ? Math.min(cell * ASIDE_MAX_CELLS, spare)
      : 0

  const controls: Bounds = {
    x: slot.x,
    y: top + bufH + framePadV + bandGap,
    width: slot.width,
    height: controlsH,
  }
  const bodyInset = cell * 0.22
  const controlsBody: Bounds = {
    x: controls.x + bodyInset,
    y: controls.y + bodyInset,
    width: Math.max(0, controls.width - bodyInset * 2),
    height: Math.max(0, controls.height - bodyInset * 2),
  }

  // Panes run the framed buffer's full height, which is what keeps them from
  // reading as boxes floating in a flank and lines all three rules up.
  const framePad = cell * FRAME_PAD_CELLS
  const bufferFrame: Bounds = {
    x: buffer.x - framePad,
    y: buffer.y - framePad,
    width: bufW + framePad * 2,
    height: bufH + framePad * 2,
  }
  const paneTop = bufferFrame.y
  const paneH = bufferFrame.height
  const fixedLeft =
    (SEC.bank +
      SEC.bankCap +
      SEC.divider +
      (clock ? SEC.clock + SEC.divider : 0)) *
    cell
  const fixedRight =
    (SEC.readout * 2 + SEC.levelReadout + SEC.divider * 3 + SEC.queueTitle) *
    cell

  return {
    slot,
    cell,
    buffer,
    bufferFrame,
    gutter,
    flankGap,
    asideGap,
    paneW,
    asideW,
    paneTop,
    paneH,
    controls,
    controlsBody,
    logRoom: Math.max(0, paneH - fixedLeft),
    queueRoom: Math.max(0, paneH - fixedRight),
  }
}

/**
 * Walk the ladder once.
 *
 * Each rung is checked against the space that rung actually competes for, so
 * this is an ordered list rather than a single running total, but it is still
 * one place to read and one place to test.
 */
function resolveChrome(m: SeatMetrics, headerW: number, floor: number): Chrome {
  const lineH = Math.max(floor * 1.45, m.cell * 0.62)

  // A tick's number needs to fit beside the buffer without touching it.
  const ticks = m.flankGap >= floor * 2.2 && m.cell >= floor * 1.2

  const gutter = m.gutter.width > 0

  const logFit = Math.floor(m.logRoom / lineH)
  const logLines = logFit >= LOG_MIN_LINES ? Math.min(LOG_MAX_LINES, logFit) : 0

  // Clamped continuously rather than in steps: the queue is readable at any
  // depth, and stepping would waste room that a row would have used.
  const rowH = SEC.queueRow * m.cell
  const queueCount = Math.max(
    1,
    Math.min(RULES.nextCount, Math.floor(m.queueRoom / rowH)),
  )

  // Roughly a character of width per field name plus its value.
  const statusFields = Math.max(
    0,
    Math.min(4, Math.floor(headerW / (floor * 13))),
  )
  const headerDetail = headerW >= floor * 34

  return { ticks, gutter, logLines, queueCount, statusFields, headerDetail }
}

function placeSeat(
  m: SeatMetrics,
  chrome: Chrome,
  clock: boolean,
): SeatGeometry {
  const { cell, buffer, slot } = m

  // The asides take the outer edges and the working panes sit inboard of them,
  // nearest the board, which is where a hand and an eye both want them.
  const outer = m.asideW > 0 ? m.asideW + m.asideGap : 0
  const statePane: Bounds = {
    x: slot.x + outer,
    y: m.paneTop,
    width: m.paneW,
    height: m.paneH,
  }
  const statsPane: Bounds = {
    x: slot.x + slot.width - outer - m.paneW,
    y: m.paneTop,
    width: m.paneW,
    height: m.paneH,
  }
  // Split roughly three to two, so the meters get the taller half and the
  // build gets enough for a label, a bar and a line under it.
  const splitGap = cell * 0.5
  const topH = (m.paneH - splitGap) * 0.62
  const asideLeftTop: Bounds =
    m.asideW > 0
      ? { x: slot.x, y: m.paneTop, width: m.asideW, height: topH }
      : ZERO
  const asideLeftBottom: Bounds =
    m.asideW > 0
      ? {
          x: slot.x,
          y: m.paneTop + topH + splitGap,
          width: m.asideW,
          height: m.paneH - topH - splitGap,
        }
      : ZERO
  const asideRight: Bounds =
    m.asideW > 0
      ? {
          x: slot.x + slot.width - m.asideW,
          y: m.paneTop,
          width: m.asideW,
          height: m.paneH,
        }
      : ZERO
  const gutter: Bounds = chrome.gutter ? m.gutter : ZERO

  // Left pane, top down: the bank and its key, then the log, then the clock
  // pinned to the bottom because the constraint the mode is about belongs
  // nearest the hands.
  const pad = cell * 0.26
  let y = m.paneTop + pad
  const innerW = Math.max(0, m.paneW - pad * 2)
  const innerX = statePane.x + pad
  const hold: Bounds = { x: innerX, y, width: innerW, height: SEC.bank * cell }
  y += hold.height
  const holdButton: Bounds = {
    x: innerX,
    y,
    width: innerW,
    height: SEC.bankCap * cell,
  }
  y += holdButton.height + SEC.divider * cell

  const paneBottom = m.paneTop + m.paneH - pad
  let clockRect: Bounds = ZERO
  let logBottom = paneBottom
  if (clock) {
    clockRect = {
      x: innerX,
      y: paneBottom - SEC.clock * cell,
      width: innerW,
      height: SEC.clock * cell,
    }
    logBottom = clockRect.y - SEC.divider * cell
  }
  const log: Bounds =
    chrome.logLines > 0
      ? { x: innerX, y, width: innerW, height: Math.max(0, logBottom - y) }
      : ZERO

  // Right pane, readouts pinned to the bottom for the same reason, and the
  // queue taking what is left at the top.
  const rInnerX = statsPane.x + pad
  let ry = paneBottom
  ry -= SEC.readout * cell
  const lines: Bounds = {
    x: rInnerX,
    y: ry,
    width: innerW,
    height: SEC.readout * cell,
  }
  ry -= SEC.divider * cell + SEC.levelReadout * cell
  const level: Bounds = {
    x: rInnerX,
    y: ry,
    width: innerW,
    height: SEC.levelReadout * cell,
  }
  ry -= SEC.divider * cell + SEC.readout * cell
  const score: Bounds = {
    x: rInnerX,
    y: ry,
    width: innerW,
    height: SEC.readout * cell,
  }
  const nextTop = m.paneTop + pad
  const next: Bounds = {
    x: rInnerX,
    y: nextTop,
    width: innerW,
    height: Math.max(0, ry - SEC.divider * cell - nextTop),
  }

  return {
    buffer,
    bufferFrame: m.bufferFrame,
    cell,
    gutter,
    statePane,
    statsPane,
    asideLeftTop,
    asideLeftBottom,
    asideRight,
    hold,
    holdButton,
    log,
    clock: clockRect,
    next,
    score,
    level,
    lines,
    controls: m.controls,
    controlsBody: m.controlsBody,
  }
}

/**
 * Which control a button is.
 *
 * Hold is not among them. Banking a piece belongs beside the pocket it fills,
 * where the thing it does is visible, rather than in a grid of steering
 * controls it has nothing in common with.
 */
export type ControlId =
  'left' | 'right' | 'softDrop' | 'rotateCCW' | 'rotateCW' | 'hardDrop'

/** Air between the two caps of one group, as a fraction of a cap. */
const PAIR_GAP_FRAC = 0.08
/** Air between two groups, as a fraction of a cap. */
const GROUP_GAP_FRAC = 0.225

/** The three groups, in the order they sit across the band. */
const CONTROL_GROUPS: readonly (readonly ControlId[])[] = [
  ['left', 'rotateCCW'],
  ['softDrop', 'hardDrop'],
  ['rotateCW', 'right'],
]

/**
 * The control band: three pairs of squares.
 *
 *       left  turn <      soft  hard      > turn  right
 *
 * Every cap is the same square, because a square is what a mark drawn in a
 * square box wants to sit in, and because six identical targets are read as one
 * control surface where six different rectangles are read as a diagram.
 *
 * The pairing is still direction with the turn that goes the same way, so a
 * thumb reaching left both moves and turns left. The two are side by side now
 * rather than stacked, which is what a band this height can hold at full size:
 * stacked halves were a third of a cap each.
 *
 * The gap either side of the drops is the point of the three groups. A thumb
 * sliding in from a movement key should run out of buttons before it reaches a
 * hard drop, because that is the one press that cannot be taken back.
 */
export function computeControlRects(band: Bounds): Record<ControlId, Bounds> {
  const caps = 6
  // Six caps, one pair gap inside each of the three groups, two group gaps.
  const span = caps + PAIR_GAP_FRAC * 3 + GROUP_GAP_FRAC * 2
  // The band's height is the cap's size. It is already a deliberate fraction of
  // the region, so a separate minimum would only ever fight it.
  const side = Math.min(band.height, band.width / span)
  const y = band.y + (band.height - side) / 2
  let x = band.x + (band.width - side * span) / 2

  const out = {} as Record<ControlId, Bounds>
  for (let g = 0; g < CONTROL_GROUPS.length; g++) {
    for (const id of CONTROL_GROUPS[g]) {
      out[id] = { x, y, width: side, height: side }
      x += side * (1 + PAIR_GAP_FRAC)
    }
    // The pair gap follows the group's last cap, so swap it for the wider gap
    // that separates one group from the next.
    if (g < CONTROL_GROUPS.length - 1) {
      x += side * (GROUP_GAP_FRAC - PAIR_GAP_FRAC)
    }
  }
  return out
}

/** Top-left of cell `(col, row)` inside a placed buffer. */
export function cellOrigin(
  geom: SeatGeometry,
  col: number,
  row: number,
): { x: number; y: number } {
  return {
    x: geom.buffer.x + col * geom.cell,
    y: geom.buffer.y + row * geom.cell,
  }
}

/** Whether a world point falls inside the buffer. */
export function insideBuffer(
  geom: SeatGeometry,
  x: number,
  y: number,
): boolean {
  const b = geom.buffer
  return x >= b.x && x <= b.x + b.width && y >= b.y && y <= b.y + b.height
}
