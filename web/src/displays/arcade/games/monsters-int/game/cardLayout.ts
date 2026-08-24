/**
 * Where a card sits: in the mouth, at the reveal, or in a seat's fan.
 *
 * @remarks
 *   Pure, in layout space, converted to metres at the last step. Cards lie flat
 *   at rest, which costs their art most of its height at this camera angle, so
 *   the freshly drawn card and the hand being decided on are both held up off
 *   the table where they can be read.
 *
 *   Held up is literal. `hoverFromLayout` trades height against depth so the two
 *   cancel on screen, which means a pose can be brought right up to the camera
 *   without moving. That is what puts the foreground in front of the fog rather
 *   than inside it, and what makes it draw over the hands it crosses.
 */
import type { CardPose } from './nodes/CardNode'
import { groundFromLayout, hoverFromLayout, PX_TO_M } from './project'
import { BANNER, CARD, FOCUS, MOUTH, TABLE } from './tuning'
import { fanHalfWidth, fanStepFor, type SeatPlacement } from './seats'
import { REGION_WIDTH } from '../../../world'

/** Where the reveal happens: the centre of the table, over every hand. */
export const REVEAL = {
  x: TABLE.centerX,
  /**
   * Screen centre of the card, not the point it stands on.
   *
   * Low, in the gap the seats leave between themselves and the buttons. Only
   * the far seat sits in this column, so dropping the reveal here is what puts
   * clear air between it and the hand being decided on.
   */
  y: 540,
  /**
   * Held up toward the camera, the same distance as a focused hand. It sits
   * lower on screen than that hand, which at this camera angle already puts it
   * nearer, so the card just drawn is the one in front.
   */
  hover: FOCUS.hover,
} as const

/** How much larger the revealed card is drawn. */
export const REVEAL_SCALE = 1.25

/** Just inside the mouth, where a dealt card comes from. */
export function mouthPose(): CardPose {
  const p = groundFromLayout(MOUTH.centerX, MOUTH.centerY)
  return { x: p.x, y: 0.001, z: p.z, facing: 'flat', scale: 0.5 }
}

/**
 * Where a card is first SEEN, which is not where it comes from.
 *
 * The mouth's centre sits well under the lip, so anything thrown from there is
 * behind it. This is the lip's own top edge, so dust rises out of the hole
 * instead of appearing above it.
 */
export function spitPoint(): { x: number; y: number } {
  return { x: MOUTH.centerX, y: BANNER.top }
}

/**
 * How tall a card in the focused hand stands on screen, in layout px.
 *
 * A tilted card keeps `sin(tilt)` of its height, where the tilt is measured
 * toward the camera: at 90 degrees it faces the camera square and keeps all of
 * it. What sits above the focused hand is placed against this rather than
 * against the drawn height, which the hand never shows.
 */
export function focusScreenHeight(): number {
  return CARD.height * FOCUS.scale * Math.sin((FOCUS.tiltDeg * Math.PI) / 180)
}

/**
 * A repeatable angle in `-1..1` for a card, so it keeps the one it was given.
 *
 * Hashed rather than drawn from a generator, because a hand is re-placed every
 * time anything happens and a card that picked a new angle each pass would
 * twitch on the table.
 */
function jitter(a: number, b: number): number {
  const n = Math.sin(a * 12.9898 + b * 78.233) * 43758.5453
  return (n - Math.floor(n)) * 2 - 1
}

/** A few degrees off square, so a hand reads as put down rather than plotted. */
function spread(seat: number, index: number): number {
  return (jitter(seat + 1, index + 1) * CARD.spread * Math.PI) / 180
}

/**
 * Upright and large over the middle of the table, square to the camera.
 *
 * Cards revealed together sit side by side rather than one replacing the last,
 * because a Three More lands three at once and the point of the reveal is that
 * every one of them can be read.
 */
export function revealPose(index = 0, count = 1): CardPose {
  const step = CARD.revealStep * REVEAL_SCALE
  const span = Math.max(0, count - 1) * step
  const p = hoverFromLayout(
    REVEAL.x - span / 2 + index * step,
    REVEAL.y,
    REVEAL.hover * PX_TO_M,
  )
  return { x: p.x, y: p.y, z: p.z, facing: 'upright', scale: REVEAL_SCALE }
}

/**
 * Where card `index` of `count` sits in a seat's fan.
 *
 * The fan is centred on the seat, so it grows evenly to both sides rather than
 * drifting off one edge as a hand fills up. Each card is lifted a hair above
 * the one before it, which is what lets the depth test resolve the overlap
 * crisply instead of z-fighting.
 */
export function fanPose(
  seat: SeatPlacement,
  index: number,
  count: number,
  space: number,
): CardPose {
  const step = fanStepFor(count, space)
  const half = fanHalfWidth(count, step)
  const x = seat.layout.x - half + CARD.width / 2 + index * step
  const ground = groundFromLayout(x, seat.layout.y)
  return {
    x: ground.x,
    y: (index + 1) * CARD.lift * PX_TO_M,
    z: ground.z,
    facing: 'flat',
    spin: spread(seat.seat, index),
  }
}

/**
 * Where card `index` sits while this seat is the one deciding.
 *
 * The hand leaves its seat entirely and lays out across the top of the frame,
 * under the caption. Everyone at the table is reading it, so it belongs where
 * everyone is already looking rather than off at one side.
 */
export function focusPose(index: number, count: number): CardPose {
  const step = fanStepFor(count, REGION_WIDTH - FOCUS.margin * 2, FOCUS.scale)
  const span = Math.max(0, count - 1) * step
  const p = hoverFromLayout(
    FOCUS.centerX - span / 2 + index * step,
    FOCUS.centerY,
    FOCUS.hover * PX_TO_M + index * CARD.lift * PX_TO_M,
  )
  return { x: p.x, y: p.y, z: p.z, facing: 'tilted', scale: FOCUS.scale }
}

/**
 * Where an aimed card lands on the seat it was played at.
 *
 * Upright and held toward the camera, above that seat's own cards rather than
 * among them. The card never joins the hand, it arrives, does what it does and
 * comes apart, so it wants to read as delivered rather than as dealt.
 */
export function deliveryPose(seat: SeatPlacement): CardPose {
  const p = hoverFromLayout(
    seat.layout.x,
    seat.layout.y - CARD.height * 0.5,
    FOCUS.hover * PX_TO_M,
  )
  return { x: p.x, y: p.y, z: p.z, facing: 'upright', scale: DELIVERY_SCALE }
}

/** Smaller than the reveal: it has already been read once on the way here. */
const DELIVERY_SCALE = 0.9

/**
 * A seat's modifier cards, tucked below its numbers.
 *
 * Kept apart because they play by different rules: they never bust, never count
 * toward the seven, and a player reads them as a total rather than a set. Below
 * rather than above, so they share no space with the seat's score pill, and
 * small, because a total needs less room than a set does.
 */
export function modifierPose(
  seat: SeatPlacement,
  index: number,
  count: number,
): CardPose {
  const step = CARD.modifierStep
  const span = Math.max(0, count - 1) * step
  const x = seat.layout.x - span / 2 + index * step
  const y = seat.layout.y + CARD.height * 0.42
  const ground = groundFromLayout(x, y)
  return {
    x: ground.x,
    y: (index + 1) * CARD.lift * PX_TO_M,
    z: ground.z,
    facing: 'flat',
    scale: CARD.modifierScale,
    spin: spread(seat.seat + 8, index),
  }
}
