/**
 * What each moment on the table throws, and in what colour.
 *
 * @remarks
 *   Pure, and the whole design surface of the particle work. `burstFor` reads the
 *   kinematics out of `FLOURISH` and supplies the two things that cannot be a
 *   constant: the shapes, which follow the seat, and the palette, which follows
 *   the card. A test can pin every beat from here with no canvas.
 *
 *   Positions are in layout space, which is world space (see `project.ts`), so a
 *   burst placed at a card's own position lands on it with no projection.
 * @example
 *   for (const spec of burstFor({ kind: 'seven', at, seat }))
 *     confetti.play(spec)
 */
import type { DeckCard } from './rules/cards'
import type { SeatId } from './rules/player'
import {
  COLORS,
  FLOURISH,
  SEATS,
  type BurstFeel,
  type BurstName,
} from './tuning'

/** Every beat except the seven's second layer, which nothing outside asks for. */
export type FlourishKind = Exclude<BurstName, 'sevenFlecks'>

export interface Flourish {
  kind: FlourishKind
  /** In layout space. */
  at: { x: number; y: number }
  /** Whose it is, when that picks the shape and the colour. */
  seat?: SeatId
  /** The accent of the card that caused it, for a beat a card caused. */
  color?: string
}

/** One burst, ready to fire. */
export interface BurstSpec extends BurstFeel {
  x: number
  y: number
  /** Picked from uniformly, per piece. */
  palette: readonly string[]
}

/**
 * The accent a card face is drawn in.
 *
 * Number cards are cream on ink, so they have no accent of their own and come
 * apart in the paper they are printed on.
 */
export function cardColor(card: DeckCard): string {
  switch (card.card.kind) {
    case 'freeze':
      return COLORS.freeze
    case 'threeMore':
      return COLORS.threeMore
    case 'extraLife':
      return COLORS.extraLife
    case 'plus':
      return COLORS.bonus
    case 'times2':
      return COLORS.times2
    default:
      return COLORS.cream
  }
}

/**
 * The bursts one moment throws, in draw order.
 *
 * A list rather than one burst, because the seven throws two: one colour at one
 * size is a strong read and a monotonous one, so smaller, faster flecks in the
 * table's own inks go up with the seat's.
 */
export function burstFor(f: Flourish): BurstSpec[] {
  const spec = (name: BurstName, palette: readonly string[]): BurstSpec => ({
    ...FLOURISH[name],
    x: f.at.x,
    y: f.at.y,
    palette,
  })

  switch (f.kind) {
    case 'spit':
      // Never ink. This fires on every card in the game, and a dark spray
      // repeated that often reads as the table getting dirty rather than as
      // anything happening.
      return [spec('spit', [COLORS.spit])]
    case 'bust':
      return [spec('bust', [COLORS.ink, COLORS.inkShade])]
    case 'save':
      return [spec('save', [COLORS.extraLife, COLORS.tongue, COLORS.cream])]
    case 'dissolve':
    case 'shatter':
    case 'float':
      // The card's own two colours: its accent, and the ink every face is
      // printed on.
      return [spec(f.kind, [f.color ?? COLORS.cream, COLORS.ink])]
    case 'seven': {
      const seat = f.seat ?? 0
      const identity = SEATS[seat % SEATS.length]!
      return [
        spec('seven', [identity.color]),
        spec('sevenFlecks', [COLORS.cream, COLORS.ink]),
      ]
    }
  }
}
