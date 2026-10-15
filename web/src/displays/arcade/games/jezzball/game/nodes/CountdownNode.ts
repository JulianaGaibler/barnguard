/**
 * The big countdown digit/GO text, engine port of the `.count` overlay, fading
 * in/out over 120ms exactly like the original `transition:fade`.
 */
import { Node2D, definePaintProps, type Canvas } from '@src/stargazer'
import { COLORS } from '../tuning'
import { headingFont } from '../../fonts'

const FADE_SEC = 0.12

export class CountdownNode extends Node2D {
  declare label: string
  #visible = false

  constructor() {
    super('jb-countdown')
    definePaintProps(this, { label: '' })
    this.transform.alpha = 0
  }

  /** Set the label. `null` (or empty) hides (fades out) the node. */
  setLabel(label: string | null): void {
    if (label) this.label = label
    const shown = !!label
    if (shown === this.#visible) return
    this.#visible = shown
    this.play({ alpha: shown ? 1 : 0 }, { duration: FADE_SEC })
  }

  override paint(gfx: Canvas): void {
    gfx.fillText(this.label, 0, 0, {
      font: headingFont(900, 144),
      align: 'center',
      baseline: 'middle',
      color: COLORS.ink,
    })
  }
}
