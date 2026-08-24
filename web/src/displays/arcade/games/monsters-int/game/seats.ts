/**
 * Where each player's cards sit on the table.
 *
 * @remarks
 *   Seats sit on an ellipse concentric with the table, and everyone sits to one
 *   side or the other. The middle of the frame is {@link CLEAR_COLUMN}, the
 *   stage the drawn card and the hand being decided on are held up in, and the
 *   bottom of it belongs to the buttons and the mouth.
 *
 *   That is what makes the odd counts asymmetric, and it is not a tuning choice:
 *   any symmetric arrangement of an odd number of seats has one of them at top
 *   dead centre, which is the middle of the stage. Three and five players
 *   therefore sit two-and-one and three-and-two.
 *
 *   The angles are a hand-tuned table rather than an even spread, and they run
 *   past the horizontal so the extra players at five seats go down the sides
 *   rather than into the middle. Ordered left to right by where they land, not
 *   by angle. A designer nudging one of these is the expected way to change the
 *   layout, and `seats.test.ts` is what catches a nudge that breaks it.
 * @example
 *   for (const seat of seatPlacements(4)) {
 *     token.transform.setPosition(seat.anchor.x, 0, seat.anchor.z)
 *   }
 */
import type { Vec3 } from '@src/stargazer'
import { groundFromLayout } from './project'
import { CARD, CLEAR_COLUMN, SEAT_RING } from './tuning'
import { REGION_WIDTH } from '../../../world'

/** Player counts the table is laid out for. */
export type SeatCount = 2 | 3 | 4 | 5

export interface SeatPlacement {
  /** Index into `SEATS`, and the seat's identity everywhere else. */
  readonly seat: number
  /** Where the fan stands, in world metres on the table plane. */
  readonly anchor: Vec3
  /** The same point in layout space, for the 2D chip above it. */
  readonly layout: { x: number; y: number }
}

/**
 * Degrees around the table, measured from the right-hand edge. 0 is due right,
 * 180 due left, and negative sweeps below the horizontal down the near side.
 *
 * Listed right to left as they land on screen, which at five seats is not the
 * order of the angles: the two extra players sit low on the sides, past the
 * ends of the far arc.
 */
export const SEAT_ANGLES_DEG: Record<SeatCount, readonly number[]> = {
  2: [0, 180],
  3: [0, 123, 180],
  4: [0, 57, 123, 180],
  5: [0, -39, 57, 219, 180],
}

export function seatPlacements(count: SeatCount): readonly SeatPlacement[] {
  return SEAT_ANGLES_DEG[count].map((deg, seat) => {
    const a = (deg * Math.PI) / 180
    // Screen-space y grows downward, so the far side of the table is negative.
    const x = SEAT_RING.centerX + Math.cos(a) * SEAT_RING.radiusX
    const y = SEAT_RING.centerY - Math.sin(a) * SEAT_RING.radiusY
    return { seat, anchor: groundFromLayout(x, y), layout: { x, y } }
  })
}

/**
 * How much width a seat's hand may take, in layout px.
 *
 * The distance to whichever is nearer, a neighbouring seat or the frame edge,
 * less a margin. This is what lets a hand lie unfolded when there is room and
 * tighten only when there is not, so two players spread out and five do not
 * collide.
 */
export function seatSpace(count: SeatCount, seat: number): number {
  const seats = seatPlacements(count)
  const here = seats[seat]
  if (!here) return CARD.width
  let nearest = Math.min(here.layout.x, REGION_WIDTH - here.layout.x) * 2
  for (const other of seats) {
    if (other.seat === seat) continue
    // Only neighbours at a similar depth compete for width. A seat on the far
    // arc and one at the side can overlap horizontally without touching.
    if (Math.abs(other.layout.y - here.layout.y) > CARD.height * 0.8) continue
    nearest = Math.min(nearest, Math.abs(other.layout.x - here.layout.x) * 2)
  }
  // And the stage in the middle, which no hand may spread into however much
  // room its neighbours leave it. A seat far from anyone else has plenty of
  // space by every other measure and is exactly the one that would reach in.
  const side = here.layout.x > SEAT_RING.centerX ? 1 : -1
  const edge = SEAT_RING.centerX + side * CLEAR_COLUMN
  nearest = Math.min(nearest, Math.abs(here.layout.x - edge) * 2)
  return Math.max(CARD.width, nearest - SEAT_GUTTER)
}

/** Kept between two hands, and between a hand and the frame edge. */
const SEAT_GUTTER = 46

/**
 * Step between cards in a hand of `cards`, given the width it may use.
 *
 * Fully unfolded when the hand fits, tightening toward a stack as it grows.
 * Clamped at a minimum so a large hand stays countable rather than collapsing
 * into one card.
 */
export function fanStepFor(
  cards: number,
  available: number,
  scale = 1,
): number {
  const width = CARD.width * scale
  const unfolded = CARD.unfoldedStep * scale
  if (cards <= 1) return unfolded
  const fits = (available - width) / (cards - 1)
  return Math.max(CARD.minStep * scale, Math.min(unfolded, fits))
}

/** Half the width a hand of `cards` occupies at this step. */
export function fanHalfWidth(
  cards: number,
  step: number = CARD.fanStep,
): number {
  return (CARD.width + Math.max(0, cards - 1) * step) / 2
}
