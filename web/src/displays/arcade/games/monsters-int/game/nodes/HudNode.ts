/**
 * The 2D layer over the table: the monster's lower lip across the bottom, the
 * two readouts painted on it, and a chip per seat.
 *
 * @remarks
 *   Placed in plain layout coordinates. One design pixel is one millimetre of
 *   table, so a 2D node at layout `(806, 880)` lands under the 3D button at
 *   `groundFromLayout(806, 800)` at any canvas aspect and throughout the camera
 *   pan, with no projection work per frame.
 *
 *   That is also why this layer owns the lip. The 2D layers draw over the whole
 *   3D pass, so the lip lands in front of the near end of the table and the
 *   tongue in front of the lip, with no depth to arrange and nothing that can
 *   sort wrong.
 */
import { Node2D, textWidth, type Gfx2D, type Rect } from '@src/stargazer'
import { displayFont, font } from '../../fonts'
import { MONSTERS_INT_STRINGS as t } from '../../strings'
import type { BannerArt } from '../art/bannerArt'
import { focusScreenHeight } from '../cardLayout'
import { flatForeshortening } from '../project'
import { BANNER, CARD, COLORS, FOCUS, SEATS } from '../tuning'
import { REGION_HEIGHT, REGION_WIDTH } from '../../../../world'
import type { SeatId } from '../rules/player'
import type { TableStatus } from '../session'
import { seatPlacements, type SeatCount } from '../seats'

/** What a seat's chip shows. */
export interface SeatHud {
  seat: SeatId
  label: string
  /** Running total across the match. */
  total: number
  /** What this round is worth so far, or null once they are out with nothing. */
  round: number | null
  status: 'active' | 'stayed' | 'busted' | 'hasSeven'
  /** Whether it is this seat's turn. */
  up: boolean
}

const CHIP_HEIGHT = 40
const CHIP_RADIUS = 20
const CHIP_PAD = 13
/** Diameter of the seat's shape inside the pill. */
const GLYPH = 22

/** Clear air between the top of a hand and the pill above it. */
const CHIP_GAP = 24

/** Padding inside a total pill, and the gap between two of them. */
const TOTAL_PAD = 11
const TOTAL_GAP = 8

/**
 * Where a seat's pill sits, given whether that seat's hand is lifted.
 *
 * The pill follows its hand. A hand being decided on leaves its seat for the
 * middle of the frame, and a pill left behind at an empty seat stops saying
 * whose cards those are, which is the one thing it is for.
 *
 * The rise is measured against the hand's height ON SCREEN, which is well short
 * of the drawn height in both poses: flat cards are foreshortened by the camera
 * pitch, and a tilted hand keeps only `sin(tilt)` of its own. Using the drawn
 * height instead pushes every pill off the top of the frame.
 */
/**
 * Where to put the lip path so it fills the bottom of whatever is on screen.
 *
 * The design region is only what the camera frames at 16:9. On any other aspect
 * the visible rect is wider or taller, and a lip drawn to 1920 by 1080 stops
 * short of the edge and leaves a band of table showing beside it.
 *
 * Overdrawn past three edges on top of that. The path is authored flush to the
 * frame and its bottom stops a fraction short of its own height, so at 1:1 the
 * antialiased border shows a hairline. Only the top edge is left where the art
 * puts it, since that is the one that has to land right.
 */
export function lipTransform(view: Rect): {
  x: number
  y: number
  scaleX: number
  scaleY: number
} {
  const foot = view.y + view.height
  return {
    x: view.x - BANNER.bleed,
    y: BANNER.top,
    scaleX: (view.width + BANNER.bleed * 2) / REGION_WIDTH,
    scaleY: (foot - BANNER.top + BANNER.bleed) / BANNER.artHeight,
  }
}

export function chipAnchor(
  hand: { x: number; y: number },
  lifted: boolean,
): { x: number; y: number } {
  const height = lifted ? focusScreenHeight() : flatForeshortening(CARD.height)
  return {
    x: lifted ? FOCUS.centerX : hand.x,
    y: (lifted ? FOCUS.centerY : hand.y) - height / 2 - CHIP_HEIGHT - CHIP_GAP,
  }
}

export class HudNode extends Node2D {
  #seats: SeatHud[] = []
  #placements = seatPlacements(2)
  #focused: SeatId | null = null
  #art: BannerArt | null = null
  #round = 1
  #totals: readonly number[] = []
  /**
   * The world rect the camera actually frames, which is the design region only
   * at 16:9. Everything anchored to a frame edge reads it rather than the
   * region, or the lip stops short of a wide screen and leaves table showing.
   */
  #view: Rect = { x: 0, y: 0, width: REGION_WIDTH, height: REGION_HEIGHT }
  #status: TableStatus = { seat: null, text: '', note: '' }

  constructor() {
    super('monsters-int-hud')
    // Over the 3D pass and over the table's own 2D, but under any DOM overlay.
    this.renderLayer = 'dynamic'
    // Nothing to report until a round starts, and the 2D layers draw over the
    // shared sky, so an always-on HUD would sit on top of the menu.
    this.visible = false
  }

  setSeatCount(count: SeatCount): void {
    this.#placements = seatPlacements(count)
  }

  setSeats(seats: SeatHud[]): void {
    this.#seats = seats
  }

  /**
   * Whose hand is lifted, so their pill goes with it.
   *
   * Reported by the table rather than derived from the prompt: the hand stays
   * up through the whole animation after a player hits, and the prompt is
   * already closed by then.
   */
  setFocusedSeat(seat: SeatId | null): void {
    this.#focused = seat
  }

  /** Take the visible rect, which is what the lip stretches to fill. */
  setViewport(view: Rect): void {
    this.#view = view
  }

  /** The lip and its tongue, once the artwork has parsed. */
  setArt(art: BannerArt): void {
    this.#art = art
  }

  /** Left of the lip: which round it is, and what everyone has banked. */
  setMatch(round: number, totals: readonly number[]): void {
    this.#round = round
    this.#totals = totals
  }

  /** Right of the lip: whose shape is up, and what that means. */
  setStatus(status: TableStatus): void {
    this.#status = status
  }

  override draw(gfx: Gfx2D): void {
    // Chips first. The lip is opaque and covers whatever reaches it, which is
    // what keeps a hand near the buttons from spilling into the readouts.
    for (const seat of this.#seats) this.#drawChip(gfx, seat)
    this.#drawLip(gfx)
    this.#drawMatch(gfx)
    this.#drawStatus(gfx)
  }

  /**
   * The lip, and the tongue hanging over it.
   *
   * Paths rather than textures, so they stay sharp at whatever size the booth
   * screen is. The tongue goes on last: it hangs out of a hole, and a hole only
   * reads as one if what comes out of it is in front.
   */
  #drawLip(gfx: Gfx2D): void {
    const art = this.#art
    if (!art) return
    gfx.save()
    const at = lipTransform(this.#view)
    gfx.translate(at.x, at.y)
    gfx.scale(at.scaleX, at.scaleY)
    gfx.fillPath2D(art.lip.path, art.lip.color)
    gfx.restore()
    gfx.save()
    gfx.translate(BANNER.tongueX, BANNER.tongueY)
    for (const part of art.tongue) gfx.fillPath2D(part.path, part.color)
    gfx.restore()
  }

  /** Which round it is, and a running total per seat under it. */
  #drawMatch(gfx: Gfx2D): void {
    const left = this.#view.x + BANNER.margin
    gfx.fillText(t.round(this.#round), left, BANNER.roundY, {
      font: displayFont(30),
      align: 'left',
      baseline: 'middle',
      color: COLORS.cream,
    })
    let x = left
    for (let seat = 0; seat < this.#totals.length; seat++) {
      x += this.#drawTotal(gfx, seat, x) + TOTAL_GAP
    }
  }

  /** One seat's running total, as a shape and a number. Returns its width. */
  #drawTotal(gfx: Gfx2D, seat: SeatId, x: number): number {
    const text = String(this.#totals[seat] ?? 0)
    const face = font(700, 20)
    const width = TOTAL_PAD * 2 + BANNER.glyph + 8 + textWidth(text, face)
    const mid = BANNER.totalsY + BANNER.totalHeight / 2
    gfx.fillRoundRect(
      x,
      BANNER.totalsY,
      width,
      BANNER.totalHeight,
      BANNER.totalHeight / 2,
      COLORS.cream,
    )
    drawSeatGlyph(
      gfx,
      SEATS[seat % SEATS.length]!,
      x + TOTAL_PAD + BANNER.glyph / 2,
      mid,
      BANNER.glyph,
      false,
    )
    gfx.fillText(text, x + TOTAL_PAD + BANNER.glyph + 8, mid, {
      font: face,
      align: 'left',
      baseline: 'middle',
      color: COLORS.ink,
    })
    return width
  }

  /**
   * Whose shape is up and what that means, against the right edge.
   *
   * Right-aligned because the line changes with every event, and a left edge
   * that jumped each time would pull the eye harder than the change itself
   * deserves. The shape leads the line rather than a name, so a player can
   * match it to the cards in front of them without reading.
   */
  #drawStatus(gfx: Gfx2D): void {
    const { seat, text, note } = this.#status
    const right = this.#view.x + this.#view.width - BANNER.margin
    const face = displayFont(28)
    if (text) {
      gfx.fillText(text, right, BANNER.statusY, {
        font: face,
        align: 'right',
        baseline: 'middle',
        color: COLORS.cream,
      })
    }
    if (seat !== null) {
      // In the text's own colour, not the seat's. The shape IS the name here,
      // and a coloured one reads as a second thing to decode next to a line
      // that is already saying whose turn it is.
      const size = BANNER.glyph + 6
      drawSeatGlyph(
        gfx,
        SEATS[seat % SEATS.length]!,
        right - textWidth(text, face) - size / 2 - 4,
        BANNER.statusY,
        size,
        false,
        COLORS.cream,
      )
    }
    if (note) {
      gfx.fillText(note, right, BANNER.noteY, {
        font: font(700, 20),
        align: 'right',
        baseline: 'middle',
        color: COLORS.cream,
      })
    }
  }

  /**
   * A seat's pill: its shape, and what its hand is worth.
   *
   * The shape IS the player's name. Numbering them as well would be two names
   * for one person, and the shape is the one that matches the cards in front of
   * them and the buttons they pick from.
   */
  #drawChip(gfx: Gfx2D, seat: SeatHud): void {
    const hand = this.#placements[seat.seat]
    if (!hand) return
    const identity = SEATS[seat.seat % SEATS.length]!
    const note = statusNote(seat)
    const score = seat.round === null ? '0' : String(seat.round)
    const text = note ? `${score}  ${note}` : score
    const width = CHIP_PAD * 2 + GLYPH + 10 + textWidth(text, font(700, 24))
    const at = chipAnchor(hand.layout, seat.seat === this.#focused)
    const x = at.x - width / 2
    const y = at.y

    const out = seat.status === 'busted'
    gfx.fillRoundRect(x, y, width, CHIP_HEIGHT, CHIP_RADIUS, COLORS.cream)
    if (seat.up) {
      // A ring rather than a fill, so the pill's own colors do not change and
      // the eye only has one difference to notice.
      gfx.strokeRoundRect(x, y, width, CHIP_HEIGHT, CHIP_RADIUS, {
        color: identity.color,
        width: 4,
      })
    }
    drawSeatGlyph(
      gfx,
      identity,
      x + CHIP_PAD + GLYPH / 2,
      y + CHIP_HEIGHT / 2,
      GLYPH,
      out,
    )
    gfx.fillText(text, x + CHIP_PAD + GLYPH + 10, y + CHIP_HEIGHT / 2, {
      font: font(700, 24),
      align: 'left',
      baseline: 'middle',
      color: out ? '#9A8F8C' : COLORS.ink,
    })
  }
}

/**
 * A seat's shape, matching the one on its cards and in the target picker.
 *
 * Drawn from primitives rather than a font or an SVG so it batches with the
 * pill under it and stays crisp at any size.
 */
function drawSeatGlyph(
  gfx: Gfx2D,
  identity: (typeof SEATS)[number],
  cx: number,
  cy: number,
  size: number,
  dimmed: boolean,
  override?: string,
): void {
  const color = override ?? (dimmed ? '#C9BDB9' : identity.color)
  const r = size / 2
  if (identity.shape === 'circle') {
    gfx.fillCircle(cx, cy, r, color)
    return
  }
  const pts = new Float32Array(identity.sides * 2)
  for (let i = 0; i < identity.sides; i++) {
    const a = -Math.PI / 2 + (i / identity.sides) * Math.PI * 2
    pts[i * 2] = cx + Math.cos(a) * r
    pts[i * 2 + 1] = cy + Math.sin(a) * r
  }
  gfx.fillConvexPoly(pts, identity.sides, color)
}

/**
 * What the pill says beyond the score, or nothing.
 *
 * Only the things a hand cannot show. A held Extra Life is a card lying in
 * front of the player, so saying so as well is the same fact twice.
 */
function statusNote(seat: SeatHud): string {
  if (seat.status === 'busted') return 'BUST'
  if (seat.status === 'hasSeven') return 'SEVEN'
  if (seat.status === 'stayed') return 'STAY'
  return ''
}
