/**
 * The "waiting for other player" callout, engine port of the `.waiting`
 * overlay: an ink headline chip over an accent sub chip, fading in over 150ms
 * like the original `transition:fade`.
 */
import { Node2D, textMetrics, type Gfx2D } from '@src/stargazer'
import { COLORS, PROGRESS_ACCENT } from '../tuning'
import { font, headingFont } from '../../fonts'

const FADE_SEC = 0.15
const HEAD_FONT_PX = 57.6
const SUB_FONT_PX = 18.4

export class WaitingNode extends Node2D {
  readonly #headline: string
  readonly #sub: string

  #visible = false

  /** `sub` omitted (or empty) renders just the headline chip. */
  constructor(headline: string, sub = '') {
    super('jb-waiting')
    this.renderLayer = 'dynamic'
    this.transform.alpha = 0
    this.#headline = headline
    this.#sub = sub
  }

  setShown(visible: boolean): void {
    if (visible === this.#visible) return
    this.#visible = visible
    this.play({ alpha: visible ? 1 : 0 }, { duration: FADE_SEC })
  }

  override draw(gfx: Gfx2D): void {
    if (this.transform.alpha <= 0) return

    const headFont = headingFont(900, HEAD_FONT_PX)
    const headPadX = 17.6
    const headPadY = 4.8
    // Sized from the ink, not from `localW`/`localH`, which carry the label
    // bitmap's own transparent border on top of the padding added here.
    const headMetrics = textMetrics(this.#headline, headFont)
    const headW = headMetrics.advance + headPadX * 2
    const headH = headMetrics.ascent + headMetrics.descent + headPadY * 2
    const headX = -headW / 2
    const headY = -headH
    gfx.fillRect(headX, headY, headW, headH, COLORS.ink)
    gfx.fillText(this.#headline, 0, headY + headH / 2, {
      font: headFont,
      align: 'center',
      baseline: 'middle',
      color: COLORS.background,
    })

    if (!this.#sub) return

    const subFont = font(800, SUB_FONT_PX)
    const subPadX = 17.6
    const subPadY = 8
    const subMetrics = textMetrics(this.#sub, subFont)
    const subW = subMetrics.advance + subPadX * 2
    const subH = subMetrics.ascent + subMetrics.descent + subPadY * 2
    const subX = headX + 56 // indented right of the headline's left edge
    const subY = headY + headH - 2 // slight upward overlap
    gfx.fillRect(subX, subY, subW, subH, PROGRESS_ACCENT)
    gfx.fillText(this.#sub, subX + subW / 2, subY + subH / 2, {
      font: subFont,
      align: 'center',
      baseline: 'middle',
      color: COLORS.white,
    })
  }
}
