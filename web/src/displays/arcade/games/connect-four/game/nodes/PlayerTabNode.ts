import { Node2D, definePaintProps, type Canvas } from 'stargazer'
import { FAMILIES, fontFor, fontWith } from '@src/core/theme'
import { CONNECT_FOUR_FONTS } from '../../fonts'
import { TAB } from '../tuning'

export type PlayerTabState = 'active' | 'thinking' | 'inactive' | 'won' | 'lost'

export interface PlayerTabOptions {
  /** Card size in world units. */
  width: number
  height: number
  /** Which corner is rounded: the top-right (bookmark look). */
  roundedCorner: 'tl' | 'tr'
  /** The player's color (card fill when not won, label color when won). */
  color: string
  /** "p.1" / "p.2". */
  label: string
  /** Sublabel strings (i18n owned by the caller). */
  yourTurn: string
  thinking: string
  won: string
}

/**
 * A side tab showing a player: a card with a single rounded corner (bookmark
 * look), the "p.N" label, and a sublabel that reads "your turn" for the side to
 * move, or "thinking" while the AI decides. On a win the winner's card flips to
 * white with the player color as text, grows a folded (dog-ear) bottom-right
 * corner, and its sublabel reads "won". The session owns two of these
 * (left/right) and calls {@link setState} on turn and round-over events. It
 * toggles `visible` for the menu vs play.
 *
 * Everything (card, labels, pill) is painted by this node, so `visible = false`
 * hides the whole tab atomically. The card is composed from `fillRect` +
 * `fillCircle` (its fill is opaque, so the overlaps don't darken) rather than a
 * `Path2D`. The GPU `fillPath2D` only renders pre-registered tessellations, so
 * a runtime path draws nothing. Sizes are world units so the tab scales with
 * the board.
 */
export class PlayerTabNode extends Node2D {
  readonly #w: number
  readonly #h: number
  readonly #rounded: 'tl' | 'tr'
  readonly #radius: number
  readonly #dogEar: number
  readonly #color: string
  readonly #label: string
  readonly #yourTurn: string
  readonly #thinking: string
  readonly #wonLabel: string
  readonly #mainFont: string
  readonly #subFont: string
  readonly #subCX: number
  readonly #subCY: number
  readonly #pillH: number

  declare state: PlayerTabState

  constructor(opts: PlayerTabOptions) {
    super('cf-player-tab')
    this.#w = opts.width
    this.#h = opts.height
    this.#rounded = opts.roundedCorner
    this.#radius = opts.width * TAB.cornerRadiusFrac
    this.#dogEar = opts.width * TAB.dogEarFrac
    this.#color = opts.color
    this.#label = opts.label
    this.#yourTurn = opts.yourTurn
    this.#thinking = opts.thinking
    this.#wonLabel = opts.won
    definePaintProps(this, { state: 'inactive' as PlayerTabState })
    // The "p.N" label is body-weight sans. The sublabel is monospace, for the
    // technical feel the board chrome is going for.
    this.#mainFont = fontFor(
      CONNECT_FOUR_FONTS,
      'text',
      700,
      opts.height * 0.42,
    )
    this.#subFont = fontWith(FAMILIES.azeretMono, 700, opts.height * 0.13)
    this.#subCX = opts.width / 2
    this.#subCY = opts.height + opts.height * 0.22
    this.#pillH = opts.height * 0.24
  }

  setState(state: PlayerTabState): void {
    this.state = state
  }

  #drawCard(gfx: Canvas, fill: string): void {
    const r = this.#radius
    // One rounded corner (bookmark look): only the top-left or top-right.
    const radii: [number, number, number, number] =
      this.#rounded === 'tr' ? [0, r, 0, 0] : [r, 0, 0, 0]
    gfx.fillRoundRect(0, 0, this.#w, this.#h, radii, fill)
  }

  override paint(gfx: Canvas): void {
    const state = this.state
    const won = state === 'won'
    const showSub = state === 'active' || state === 'thinking' || won
    const subText =
      state === 'thinking'
        ? this.#thinking
        : won
          ? this.#wonLabel
          : this.#yourTurn
    this.#drawCard(gfx, won ? '#ffffff' : this.#color)

    if (won) {
      // A small gray triangle in the bottom-right corner, reading as a fold.
      const w = this.#w
      const h = this.#h
      const dogEar = this.#dogEar
      const tri = [w - dogEar, h, w, h, w, h - dogEar]
      gfx.fillConvexPoly(tri, 3, 'rgba(120, 133, 148, 0.3)')
    }

    if (showSub && !won) {
      // White capsule behind the "your turn" sublabel.
      const pw = this.#w
      const ph = this.#pillH
      const r = ph / 2
      const cx = this.#subCX
      const cy = this.#subCY
      gfx.fillRect(cx - pw / 2 + r, cy - ph / 2, pw - r * 2, ph, '#ffffff')
      gfx.fillCircle(cx - pw / 2 + r, cy, r, '#ffffff')
      gfx.fillCircle(cx + pw / 2 - r, cy, r, '#ffffff')
    }

    gfx.fillText(this.#label, this.#w / 2, this.#h * 0.5, {
      font: this.#mainFont,
      align: 'center',
      baseline: 'middle',
      color: won ? this.#color : '#ffffff',
    })

    if (showSub) {
      gfx.fillText(subText, this.#subCX, this.#subCY, {
        font: this.#subFont,
        align: 'center',
        baseline: 'middle',
        color: this.#color,
      })
    }
  }
}
