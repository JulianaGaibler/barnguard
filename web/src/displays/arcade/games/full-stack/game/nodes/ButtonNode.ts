// An in-engine button, because the DOM overlay is pointer-events: none and the
// rest of the board is canvas. Carries a label, an optional sublabel, an
// optional price in approval slips, enabled/pressed states, and an optional
// checkbox (for the flip toggle). Input is the shared `ButtonBehavior`. This
// node only draws.
//
// A price is slips rather than words, matching the slips in the resource bar
// and on the cards. "Switch floor" for one slip needs no sentence under it.
//
// The label is one size whether or not a sublabel sits under it, since the
// buttons stack and a label that grows to fill the space its neighbour gave to
// a second line reads as a different rank of control.

import {
  ButtonBehavior,
  Node2D,
  ellipsize,
  textAdvance,
  textMetrics,
  type Gfx2D,
} from '@src/stargazer'
import { COLORS } from '../tuning'
import { drawIcon, iconWidth, icons, type IconId } from '../../art/icons'
import { font } from '../../fonts'

/** Label size as a fraction of the button height. */
const LABEL_FRAC = 0.27

/** A disabled button fades whole, rather than greying only its lettering. */
const DISABLED_ALPHA = 0.45

export class ButtonNode extends Node2D {
  #w = 0
  #h = 0
  #label = ''
  #sub = ''
  /** Approval slips drawn before the label, as the button's price. */
  #price = 0
  /** Set on a button that carries artwork instead of a label. */
  #icon: IconId | null = null
  #iconChecked: IconId | null = null
  #enabled = true
  /** `null` unless this is a toggle, in which case it draws a checkbox. */
  #checked: boolean | null = null
  #pressed = false

  constructor(id: string, onClick: () => void) {
    super(id)
    this.renderLayer = 'dynamic'
    this.addBehavior(
      new ButtonBehavior({
        onClick,
        enabled: () => this.#enabled,
        onPressedChange: (pressed) => (this.#pressed = pressed),
      }),
    )
  }

  get enabled(): boolean {
    return this.#enabled
  }

  setSize(w: number, h: number): void {
    this.#w = w
    this.#h = h
    this.debugBounds = { x: 0, y: 0, width: w, height: h }
  }

  setLabel(label: string, sub = ''): void {
    this.#label = label
    this.#sub = sub
  }

  setPrice(price: number): void {
    this.#price = price
  }

  /**
   * Draw `icon` centred instead of a label.
   *
   * A checked icon button fills with the accent and swaps to the light weight,
   * where a labelled one draws a checkbox. Artwork takes no colour from
   * `drawImage`, so the two states are two files.
   */
  setIcon(icon: IconId | null, whenChecked = icon): void {
    this.#icon = icon
    this.#iconChecked = whenChecked
  }

  setEnabled(enabled: boolean): void {
    this.#enabled = enabled
    // Alpha does not cascade, but this node paints its own face, so the render
    // walk applies it to everything the button draws.
    this.transform.alpha = enabled ? 1 : DISABLED_ALPHA
  }

  setChecked(checked: boolean): void {
    this.#checked = checked
  }

  override hitTest(worldX: number, worldY: number, _slop = 0): boolean {
    if (this.#w <= 0) return false
    const p = this.worldToLocal(worldX, worldY)
    return p.x >= 0 && p.y >= 0 && p.x <= this.#w && p.y <= this.#h
  }

  #drawIconFace(gfx: Gfx2D, w: number, h: number, r: number): void {
    const set = icons()
    if (!set || !this.#icon) return
    const on = this.#checked === true
    if (on) gfx.fillRoundRect(0, 0, w, h, r, COLORS.activeSide)
    const art = set[(on ? this.#iconChecked : this.#icon) ?? this.#icon]
    const size = Math.min(w, h) * 0.46
    drawIcon(gfx, art, (w - iconWidth(art, size)) / 2, (h - size) / 2, size)
  }

  override draw(gfx: Gfx2D): void {
    const w = this.#w
    const h = this.#h
    if (w <= 0 || h <= 0) return
    // Off the height, so a square button rounds the same as a wide one. Taking
    // the smaller of the two instead leaves the square nearly sharp-cornered.
    const r = Math.min(h * 0.24, w * 0.5)
    gfx.fillRoundRect(
      0,
      0,
      w,
      h,
      r,
      this.#pressed && this.#enabled ? COLORS.pressed : COLORS.panel,
    )
    gfx.strokeRoundRect(0, 0, w, h, r, {
      color: COLORS.panelBorder,
      width: 1.5,
    })

    const ink = this.#enabled ? COLORS.ink : COLORS.disabledText

    if (this.#icon) {
      this.#drawIconFace(gfx, w, h, r)
      return
    }

    let textX = w / 2
    let align: 'center' | 'left' = 'center'

    if (this.#checked !== null) {
      const box = h * 0.36
      const bx = w * 0.07
      const by = h / 2 - box / 2
      gfx.strokeRoundRect(bx, by, box, box, box * 0.2, { color: ink, width: 2 })
      if (this.#checked) {
        gfx.fillRoundRect(
          bx + box * 0.22,
          by + box * 0.22,
          box * 0.56,
          box * 0.56,
          box * 0.12,
          COLORS.activeSide,
        )
      }
      textX = bx + box + w * 0.04
      align = 'left'
    }

    // The label and its sublabel stack as one block, centred on the button by
    // the ink they actually occupy. Placing each at a fraction of the height
    // instead leaves the pair sitting low, because an em box reserves descender
    // room that neither line uses.
    const labelSize = h * LABEL_FRAC
    const f = font(700, labelSize)
    const labelM = textMetrics(this.#label, f)
    const sf = font(500, h * 0.2)
    const subM = this.#sub ? textMetrics(this.#sub, sf) : null
    const gap = this.#sub ? h * 0.06 : 0
    const blockH =
      labelM.ascent +
      labelM.descent +
      (subM ? gap + subM.ascent + subM.descent : 0)
    const top = (h - blockH) / 2

    // A price sits on the label's own line, so the pair is measured together
    // and the group is what gets centred. Left-aligned the slips just lead.
    const set = icons()
    const slip = this.#price > 0 ? (set?.approval ?? null) : null
    const slipH = labelSize * 1.25
    const slipW = slip ? iconWidth(slip, slipH) : 0
    const slipGap = slip ? labelSize * 0.3 : 0
    const priceW = this.#price * slipW + (this.#price - 1) * slipGap * 0.4
    const leadW = slip ? priceW + slipGap : 0
    const label = ellipsize(this.#label, f, w * 0.92 - leadW)
    let labelX = textX
    if (slip) {
      const groupW = leadW + textAdvance(label, f)
      let x = align === 'center' ? textX - groupW / 2 : textX
      for (let i = 0; i < this.#price; i++) {
        if (i > 0) x += slipGap * 0.4
        x += drawIcon(
          gfx,
          slip,
          x,
          top + labelM.ascent - labelM.capHeight / 2 - slipH / 2,
          slipH,
        )
      }
      labelX = x + slipGap
      align = 'left'
    }
    gfx.fillText(label, labelX, top + labelM.ascent, {
      font: f,
      align,
      baseline: 'alphabetic',
      color: ink,
    })
    if (this.#sub && subM) {
      const subTop = top + labelM.ascent + labelM.descent + gap
      gfx.fillText(
        ellipsize(this.#sub, sf, w * 0.92),
        textX,
        subTop + subM.ascent,
        {
          font: sf,
          align,
          baseline: 'alphabetic',
          color: this.#enabled ? COLORS.inkSoft : COLORS.disabledText,
        },
      )
    }
  }
}
