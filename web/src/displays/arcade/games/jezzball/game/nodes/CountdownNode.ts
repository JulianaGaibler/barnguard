/**
 * The big countdown digit/GO text — engine port of the `.count` overlay,
 * fading in/out over 120ms exactly like the original `transition:fade`.
 */
import { SceneNode, type Gfx2D } from '@src/stargazer'
import { COLORS } from '../tuning'

const FADE_SEC = 0.12
const FONT_FAMILY = 'system-ui, sans-serif'

export class CountdownNode extends SceneNode {
  #label = ''
  #visible = false

  constructor() {
    super('jb-countdown')
    this.renderLayer = 'dynamic'
    this.transform.alpha = 0
  }

  /** Set the label; `null` (or empty) hides (fades out) the node. */
  setLabel(label: string | null): void {
    if (label) this.#label = label
    const shown = !!label
    if (shown === this.#visible) return
    this.#visible = shown
    this.play({ alpha: shown ? 1 : 0 }, { duration: FADE_SEC })
  }

  override draw(gfx: Gfx2D): void {
    if (this.transform.alpha <= 0) return
    gfx.fillText(this.#label, 0, 0, {
      font: `900 144px ${FONT_FAMILY}`,
      align: 'center',
      baseline: 'middle',
      color: COLORS.ink,
    })
  }
}
