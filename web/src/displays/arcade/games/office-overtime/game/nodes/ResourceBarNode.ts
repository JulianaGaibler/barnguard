// A side's approvals and budget, drawn on the canvas under its org. The active
// side sits on a filled accent pill with a bold label, which is the turn cue —
// it replaces the DOM HUD's copy of the same numbers.

import { Node2D, textWidth, type Gfx2D } from '@src/stargazer'
import { COLORS } from '../tuning'
import { icons } from '../../art/icons'

const font = (weight: number, size: number): string =>
  `${weight} ${Math.max(1, size).toFixed(1)}px "Mozilla Text", system-ui, sans-serif`

export class ResourceBarNode extends Node2D {
  #w = 0
  #h = 0
  #label = ''
  #approvals = 0
  #budget = 0
  #active = false

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

  override draw(gfx: Gfx2D): void {
    const w = this.#w
    const h = this.#h
    if (w <= 0 || h <= 0) return

    if (this.#active) {
      gfx.fillRoundRect(0, 0, w, h, h * 0.28, COLORS.activePill)
    }

    gfx.fillText(this.#label, h * 0.35, h / 2, {
      font: font(this.#active ? 800 : 600, h * 0.34),
      align: 'left',
      baseline: 'middle',
      color: this.#active ? COLORS.activeSide : COLORS.ink,
    })

    // Values run right to left: budget (rightmost), then approvals.
    const set = icons()
    const valFont = font(700, h * 0.4)
    const iconH = h * 0.52
    const iconW = iconH * 0.75
    const gap = h * 0.16
    let x = w - h * 0.35

    const budgetStr = `${this.#budget}k`
    x -= textWidth(budgetStr, valFont)
    gfx.fillText(budgetStr, x, h / 2, {
      font: valFont,
      align: 'left',
      baseline: 'middle',
      color: COLORS.ink,
    })
    x -= gap
    if (set) {
      x -= iconW
      gfx.drawImage(set.budget, x, h / 2 - iconH / 2, iconW, iconH)
      x -= gap * 1.4
    }

    const apStr = String(this.#approvals)
    x -= textWidth(apStr, valFont)
    gfx.fillText(apStr, x, h / 2, {
      font: valFont,
      align: 'left',
      baseline: 'middle',
      color: COLORS.ink,
    })
    x -= gap
    if (set) {
      x -= iconW
      gfx.drawImage(set.approval, x, h / 2 - iconH / 2, iconW, iconH)
    }
  }
}
