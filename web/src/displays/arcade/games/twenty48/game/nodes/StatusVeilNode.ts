/**
 * A dim over one board with a word on it: "No moves" when a run ends, "Out"
 * when a versus player is finished and the other is still going, "2048!" when a
 * board hits the goal.
 *
 * Only the alpha animates, which never repaints. The label is set while the
 * veil is transparent, so changing it repaints nothing that is on screen.
 */
import { definePaintProps, Node2D, type Canvas } from '@src/stargazer'
import { headingFont } from '../../fonts'
import type { BoardGeom } from '../layout'
import { ANIM, COLORS, inkAlpha } from '../tuning'

export class StatusVeilNode extends Node2D {
  declare geom: BoardGeom
  declare label: string | null
  #shown = false

  constructor(geom: BoardGeom) {
    super('t48-veil')
    definePaintProps(this, { geom, label: null })
    this.transform.alpha = 0
  }

  setGeom(geom: BoardGeom): void {
    this.geom = geom
  }

  /** Show `label`, or pass `null` to fade the veil away. */
  setLabel(label: string | null): void {
    if (label) this.label = label
    const shown = label !== null
    if (shown === this.#shown) return
    this.#shown = shown
    this.play({ alpha: shown ? 1 : 0 }, { duration: ANIM.veilFade })
  }

  override paint(gfx: Canvas): void {
    if (!this.label) return
    const p = this.geom
    gfx.fillRoundRect(
      p.plate.x,
      p.plate.y,
      p.plate.width,
      p.plate.height,
      p.radius * 1.15,
      inkAlpha(0.72),
    )
    gfx.fillText(
      this.label,
      p.plate.x + p.plate.width / 2,
      p.plate.y + p.plate.height / 2,
      {
        font: headingFont(700, p.cell * 0.5),
        align: 'center',
        baseline: 'middle',
        color: COLORS.inkLight,
      },
    )
  }
}
