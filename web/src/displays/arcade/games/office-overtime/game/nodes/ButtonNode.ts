// An in-engine button, because the DOM overlay is pointer-events: none and the
// rest of the board is canvas. Carries a label, an optional two-line sublabel,
// enabled/pressed states, and an optional checkbox (for the flip toggle). Input
// is the shared `ButtonBehavior`; this node only draws.

import { ButtonBehavior, Node2D, ellipsize, type Gfx2D } from '@src/stargazer'
import { COLORS } from '../tuning'

const font = (weight: number, size: number): string =>
  `${weight} ${Math.max(1, size).toFixed(1)}px "Mozilla Text", system-ui, sans-serif`

export class ButtonNode extends Node2D {
  #w = 0
  #h = 0
  #label = ''
  #sub = ''
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

  setEnabled(enabled: boolean): void {
    this.#enabled = enabled
  }

  setChecked(checked: boolean): void {
    this.#checked = checked
  }

  override hitTest(worldX: number, worldY: number, _slop = 0): boolean {
    if (this.#w <= 0) return false
    const p = this.worldToLocal(worldX, worldY)
    return p.x >= 0 && p.y >= 0 && p.x <= this.#w && p.y <= this.#h
  }

  override draw(gfx: Gfx2D): void {
    const w = this.#w
    const h = this.#h
    if (w <= 0 || h <= 0) return
    const r = Math.min(h * 0.24, w * 0.06)
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

    const labelSize = h * (this.#sub ? 0.27 : 0.36)
    const f = font(700, labelSize)
    const labelY = this.#sub ? h * 0.36 : h / 2
    gfx.fillText(ellipsize(this.#label, f, w * 0.92), textX, labelY, {
      font: f,
      align,
      baseline: 'middle',
      color: ink,
    })
    if (this.#sub) {
      const sf = font(500, h * 0.2)
      gfx.fillText(ellipsize(this.#sub, sf, w * 0.92), textX, h * 0.69, {
        font: sf,
        align,
        baseline: 'middle',
        color: this.#enabled ? COLORS.inkSoft : COLORS.disabledText,
      })
    }
  }
}
