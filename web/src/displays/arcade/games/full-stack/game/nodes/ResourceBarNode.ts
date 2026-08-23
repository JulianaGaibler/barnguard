// A side's approvals and budget, drawn on the canvas under its org. Whose turn
// it is reads off the backdrop: the active side fills its pill with the accent
// and bolds its name, the waiting side keeps the same pill as a faint outline.
// The outline is what gives the two bars a shape at rest, so the resources
// under an org look like a panel rather than text loose on the board. It
// replaces the DOM HUD's copy of the same numbers.
//
// The right-hand side mirrors: its name sits on the outer edge and its values
// run in from the middle, so the two bars read outward from the table's centre
// instead of both pointing the same way. Only the two blocks swap. The values
// keep their own order, so approvals and budget are in the same place on both
// sides.
//
// Budget reads as a figure then a note, "15k [note]". Approvals read as one
// slip per approval held, so two approvals are two slips. Leaving nine seats
// open banks twenty, well past the point where counting slips beats reading a
// number, so above `MAX_SLIPS` the row drops to a single slip and a count.

import { Node2D, textAdvance, textMetrics, type Gfx2D } from '@src/stargazer'
import { COLORS } from '../tuning'
import { drawIcon, iconWidth, icons } from '../../art/icons'
import { font } from '../../fonts'

/**
 * The baseline that centres a run's capitals on `cy`.
 *
 * `baseline: 'middle'` centres the em box instead, which sits low because the
 * box reserves room for descenders the digits here never use. The icons beside
 * the numbers are centred on their own artwork, so the two only agree when the
 * text is centred on its capitals too.
 */
const capCenteredBaseline = (cy: number, f: string): number =>
  cy + textMetrics('0', f).capHeight / 2

/** Above this many approvals the row draws one slip and a count instead. */
const MAX_SLIPS = 5

export class ResourceBarNode extends Node2D {
  #w = 0
  #h = 0
  #label = ''
  #approvals = 0
  #budget = 0
  #active = false
  #mirrored = false

  constructor(id: string) {
    super(id)
    this.renderLayer = 'dynamic'
  }

  setSize(w: number, h: number): void {
    this.#w = w
    this.#h = h
  }

  setLabel(label: string): void {
    this.#label = label
  }

  setValues(approvals: number, budget: number): void {
    this.#approvals = approvals
    this.#budget = budget
  }

  setActive(active: boolean): void {
    this.#active = active
  }

  /** Put the name on the right and the values on the left. */
  setMirrored(mirrored: boolean): void {
    this.#mirrored = mirrored
  }

  override draw(gfx: Gfx2D): void {
    const w = this.#w
    const h = this.#h
    if (w <= 0 || h <= 0) return

    const pill = h * 0.28
    if (this.#active) {
      gfx.fillRoundRect(0, 0, w, h, pill, COLORS.activePill)
    } else {
      gfx.strokeRoundRect(0, 0, w, h, pill, {
        color: COLORS.panelBorder,
        width: Math.max(1, h * 0.028),
      })
    }

    const pad = h * 0.35
    const labelFont = font(this.#active ? 800 : 600, h * 0.34)
    gfx.fillText(
      this.#label,
      this.#mirrored ? w - pad : pad,
      capCenteredBaseline(h / 2, labelFont),
      {
        font: labelFont,
        align: this.#mirrored ? 'right' : 'left',
        baseline: 'alphabetic',
        color: this.#active ? COLORS.activeSide : COLORS.ink,
      },
    )

    const set = icons()
    if (!set) return

    // Measured whole, then drawn left to right, because the approval run
    // changes width and the group is anchored to one edge or the other. The
    // repeated measurements cost one shaping pass: `textAdvance` is memoized.
    const valFont = font(700, h * 0.42)
    const valBaseline = capCenteredBaseline(h / 2, valFont)
    const slipH = h * 0.6
    const noteH = h * 0.42
    const slipW = iconWidth(set.approval, slipH)
    const noteW = iconWidth(set.budget, noteH)
    const slipGap = slipW * 0.16
    const pairGap = h * 0.2
    const groupGap = h * 0.5

    const counted = this.#approvals > MAX_SLIPS
    const slips = counted ? 1 : this.#approvals
    const overflow = counted ? `\u00d7${this.#approvals}` : ''
    const overflowW = overflow ? pairGap + textAdvance(overflow, valFont) : 0
    const approvalsW =
      this.#approvals === 0
        ? slipW + pairGap + textAdvance('0', valFont)
        : slips * slipW + (slips - 1) * slipGap + overflowW

    const budgetStr = `${this.#budget}k`
    const budgetW = textAdvance(budgetStr, valFont) + pairGap + noteW

    const groupW = approvalsW + groupGap + budgetW
    let x = this.#mirrored ? pad : w - pad - groupW

    if (this.#approvals === 0) {
      // No slips to count, so the zero has to be said out loud.
      x += drawIcon(gfx, set.approval, x, h / 2 - slipH / 2, slipH) + pairGap
      gfx.fillText('0', x, valBaseline, {
        font: valFont,
        align: 'left',
        baseline: 'alphabetic',
        color: COLORS.inkSoft,
      })
      x += textAdvance('0', valFont)
    } else {
      for (let i = 0; i < slips; i++) {
        if (i > 0) x += slipGap
        x += drawIcon(gfx, set.approval, x, h / 2 - slipH / 2, slipH)
      }
      if (overflow) {
        x += pairGap
        gfx.fillText(overflow, x, valBaseline, {
          font: valFont,
          align: 'left',
          baseline: 'alphabetic',
          color: COLORS.ink,
        })
        x += textAdvance(overflow, valFont)
      }
    }

    x += groupGap
    gfx.fillText(budgetStr, x, valBaseline, {
      font: valFont,
      align: 'left',
      baseline: 'alphabetic',
      color: COLORS.ink,
    })
    x += textAdvance(budgetStr, valFont) + pairGap
    drawIcon(gfx, set.budget, x, h / 2 - noteH / 2, noteH)
  }
}
