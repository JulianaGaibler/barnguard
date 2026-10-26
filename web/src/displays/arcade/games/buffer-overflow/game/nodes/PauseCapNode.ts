/**
 * The pause control, as a key cap.
 *
 * The shared `PauseButtonNode` bakes a rounded corner, which would be the one
 * rounded shape left anywhere on this screen. Everything else about it is worth
 * keeping, including the shared pause mark, so this borrows the glyph and draws
 * its own square cap around it.
 */
import {
  ButtonBehavior,
  Node2D,
  definePaintProps,
  type Canvas,
} from 'stargazer'
import { drawPauseGlyph } from '../../../common/pauseGlyph'
import { accentForLevel, COLORS, FRAME } from '../tuning'
import type { Bounds } from '../types'
import { drawCap, ruleWidth } from './tui'

export class PauseCapNode extends Node2D {
  declare width: number
  declare height: number
  declare pressed: boolean
  declare accent: string

  constructor(onClick: () => void) {
    super('bo-pause')
    definePaintProps(this, {
      width: 0,
      height: 0,
      pressed: false,
      accent: accentForLevel(1),
    })
    this.addBehavior(
      new ButtonBehavior({
        onClick,
        onPressedChange: (pressed) => (this.pressed = pressed),
      }),
    )
  }

  setRect(rect: Bounds): void {
    this.transform.x = rect.x
    this.transform.y = rect.y
    this.width = rect.width
    this.height = rect.height
    this.boundsOverride = { x: 0, y: 0, width: rect.width, height: rect.height }
  }

  setLevel(level: number): void {
    this.accent = accentForLevel(level)
  }

  override paint(gfx: Canvas): void {
    const w = this.width
    const h = this.height
    if (w <= 0 || h <= 0) return
    const ink = drawCap(
      gfx,
      { x: 0, y: 0, width: w, height: h },
      {
        rule: this.accent,
        width: ruleWidth(gfx, FRAME.capRulePx),
        pressed: this.pressed,
        ink: COLORS.ink,
        pressedInk: COLORS.inkDark,
        fill: COLORS.pane,
      },
    )
    drawPauseGlyph(gfx, w / 2, h / 2, Math.min(w, h), ink)
  }
}
