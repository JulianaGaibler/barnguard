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
  type CameraView2D,
  type Gfx2D,
} from '@src/stargazer'
import { drawPauseGlyph } from '../../../common/pauseGlyph'
import { accentForLevel, COLORS, FRAME } from '../tuning'
import type { Bounds } from '../types'
import { drawCap, ruleWidth } from './tui'

const ZERO: Bounds = { x: 0, y: 0, width: 0, height: 0 }

export class PauseCapNode extends Node2D {
  #rect: Bounds = ZERO
  #pressed = false
  #accent = accentForLevel(1)

  constructor(onClick: () => void) {
    super('bo-pause')
    this.renderLayer = 'dynamic'
    this.addBehavior(
      new ButtonBehavior({
        onClick,
        onPressedChange: (pressed) => (this.#pressed = pressed),
      }),
    )
  }

  setRect(rect: Bounds): void {
    this.#rect = rect
    this.transform.x = rect.x
    this.transform.y = rect.y
    this.debugBounds = { x: 0, y: 0, width: rect.width, height: rect.height }
  }

  setLevel(level: number): void {
    this.#accent = accentForLevel(level)
  }

  override draw(gfx: Gfx2D, camera: CameraView2D): void {
    const w = this.#rect.width
    const h = this.#rect.height
    if (w <= 0 || h <= 0) return
    const ink = drawCap(
      gfx,
      { x: 0, y: 0, width: w, height: h },
      {
        rule: this.#accent,
        width: ruleWidth(gfx, FRAME.capRulePx, camera.strokeSpaceScale()),
        pressed: this.#pressed,
        ink: COLORS.ink,
        pressedInk: COLORS.inkDark,
        fill: COLORS.pane,
      },
    )
    drawPauseGlyph(gfx, w / 2, h / 2, Math.min(w, h), ink)
  }
}
