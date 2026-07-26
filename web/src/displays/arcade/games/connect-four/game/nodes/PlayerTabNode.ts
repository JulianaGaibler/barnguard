import { Node2D, type Gfx2D } from '@src/stargazer'
import { TAB } from '../tuning'

export type PlayerTabState = 'active' | 'inactive' | 'won' | 'lost'

export interface PlayerTabOptions {
  /** Card size in world units. */
  width: number
  height: number
  /** Which corner is rounded: the top-right (bookmark look). */
  roundedCorner: 'tl' | 'tr'
  /** The player's color (card fill when not won; label color when won). */
  color: string
  /** "p.1" / "p.2". */
  label: string
  /** Sublabel strings (i18n owned by the caller). */
  yourTurn: string
  won: string
}

/**
 * A side tab showing a player: a card with a single rounded corner (bookmark
 * look), the "p.N" label, and a sublabel that reads "your turn" for the side to
 * move. On a win the winner's card flips to white with the player color as
 * text, grows a folded (dog-ear) bottom-right corner, and its sublabel reads
 * "won". The session owns two of these (left/right) and calls {@link setState}
 * on turn and round-over events; it toggles `visible` for the menu vs play.
 *
 * Everything (card, labels, pill) is drawn in this node's own `draw`, so
 * `visible = false` hides the whole tab atomically. (The renderer draws from a
 * flat per-layer list and checks `visible` per node, so child nodes would keep
 * drawing even with the parent hidden.) The card is composed from `fillRect` +
 * `fillCircle` (its fill is opaque, so the overlaps don't darken) rather than a
 * `Path2D` — the GPU `fillPath2D` only renders pre-registered tessellations, so
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
  readonly #wonLabel: string
  readonly #mainFont: string
  readonly #subFont: string
  readonly #subCX: number
  readonly #subCY: number
  readonly #pillH: number

  #fill: string
  #mainColor = '#ffffff'
  #subText = ''
  #subColor: string
  #showDogEar = false
  #showPill = false
  #showSub = false

  constructor(opts: PlayerTabOptions) {
    super('cf-player-tab')
    this.renderLayer = 'dynamic'
    this.#w = opts.width
    this.#h = opts.height
    this.#rounded = opts.roundedCorner
    this.#radius = opts.width * TAB.cornerRadiusFrac
    this.#dogEar = opts.width * TAB.dogEarFrac
    this.#color = opts.color
    this.#fill = opts.color
    this.#label = opts.label
    this.#yourTurn = opts.yourTurn
    this.#wonLabel = opts.won
    this.#subColor = opts.color
    this.#mainFont = `700 ${opts.height * 0.42}px ${TAB.labelFont}`
    this.#subFont = `700 ${opts.height * 0.13}px ${TAB.subFont}`
    this.#subCX = opts.width / 2
    this.#subCY = opts.height + opts.height * 0.22
    this.#pillH = opts.height * 0.24
  }

  setState(state: PlayerTabState): void {
    switch (state) {
      case 'active':
        this.#fill = this.#color
        this.#mainColor = '#ffffff'
        this.#showDogEar = false
        this.#subText = this.#yourTurn
        this.#subColor = this.#color
        this.#showSub = true
        this.#showPill = true
        break
      case 'won':
        this.#fill = '#ffffff'
        this.#mainColor = this.#color
        this.#showDogEar = true
        this.#subText = this.#wonLabel
        this.#subColor = this.#color
        this.#showSub = true
        this.#showPill = false
        break
      case 'inactive':
      case 'lost':
        this.#fill = this.#color
        this.#mainColor = '#ffffff'
        this.#showDogEar = false
        this.#showSub = false
        this.#showPill = false
        break
    }
  }

  #drawCard(gfx: Gfx2D): void {
    const r = this.#radius
    // One rounded corner (bookmark look): only the top-left or top-right.
    const radii: [number, number, number, number] =
      this.#rounded === 'tr' ? [0, r, 0, 0] : [r, 0, 0, 0]
    gfx.fillRoundRect(0, 0, this.#w, this.#h, radii, this.#fill)
  }

  override draw(gfx: Gfx2D): void {
    this.#drawCard(gfx)

    if (this.#showDogEar) {
      // A small gray triangle in the bottom-right corner, reading as a fold.
      const w = this.#w
      const h = this.#h
      const dogEar = this.#dogEar
      const tri = [w - dogEar, h, w, h, w, h - dogEar]
      gfx.fillConvexPoly(tri, 3, 'rgba(120, 133, 148, 0.3)')
    }

    if (this.#showPill) {
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
      color: this.#mainColor,
    })

    if (this.#showSub) {
      gfx.fillText(this.#subText, this.#subCX, this.#subCY, {
        font: this.#subFont,
        align: 'center',
        baseline: 'middle',
        color: this.#subColor,
      })
    }
  }
}
