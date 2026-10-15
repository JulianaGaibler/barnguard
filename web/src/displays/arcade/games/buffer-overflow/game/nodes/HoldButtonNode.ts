/**
 * The button that banks a piece, sitting directly under the pocket it fills.
 *
 * Not part of the control grid. Banking is not steering: it has no direction,
 * it is allowed once per piece, and its whole effect is visible in the pocket
 * above it. Putting it there makes the pocket and the button read as one
 * control, and makes "spent" mean something the player can see.
 *
 * Labelled in words rather than with a glyph. Every other control is a
 * direction and reads as an arrow. This one is a verb and does not.
 */
import {
  HoldButtonBehavior,
  Node2D,
  definePaintProps,
  type Canvas,
} from '@src/stargazer'
import { font } from '../../fonts'
import { textFloor } from '../layout'
import { accentForLevel, COLORS, FRAME } from '../tuning'
import type { Bounds } from '../types'
import { capBaseline, drawCap, ruleWidth } from './tui'

export interface HoldButtonOptions {
  label: string
  onPress: () => void
  /** False once the hold is spent for this piece, which is a rule, not decor. */
  enabled: () => boolean
}

export class HoldButtonNode extends Node2D {
  readonly #label: string
  readonly #enabled: () => boolean
  declare width: number
  declare height: number
  declare pressed: boolean
  declare accent: string
  /** The supplier's answer as of the last update. */
  declare live: boolean

  constructor(opts: HoldButtonOptions) {
    super('bo-hold-button')
    this.#label = opts.label
    this.#enabled = opts.enabled
    definePaintProps(this, {
      width: 0,
      height: 0,
      pressed: false,
      accent: accentForLevel(1),
      live: opts.enabled(),
    })
    this.addBehavior(
      new HoldButtonBehavior({
        onPress: opts.onPress,
        enabled: opts.enabled,
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

  override onUpdate(): void {
    this.live = this.#enabled()
  }

  /** No touch slop, for the same reason the control grid has none. */
  override hitTest(worldX: number, worldY: number): boolean {
    return super.hitTest(worldX, worldY, 0)
  }

  override paint(gfx: Canvas): void {
    const w = this.width
    const h = this.height
    if (w <= 0 || h <= 0) return
    const live = this.live
    const scale = gfx.screenScale()

    const ink = drawCap(
      gfx,
      { x: 0, y: 0, width: w, height: h },
      {
        rule: live ? this.accent : COLORS.rule,
        width: ruleWidth(gfx, FRAME.capRulePx),
        pressed: this.pressed && live,
        ink: live ? this.accent : COLORS.inkSoft,
        pressedInk: COLORS.inkDark,
        fill: COLORS.pane,
      },
    )

    // Spent reads as a dimmed label on a cap that has not moved, so the target
    // stays visibly where it was and the player is not left hunting for it.
    const size = Math.max(textFloor(scale), h * 0.3)
    const face = font(700, size)
    gfx.setAlpha(live ? 1 : 0.45)
    gfx.fillText(this.#label, w / 2, capBaseline(h / 2, face), {
      font: face,
      align: 'center',
      baseline: 'alphabetic',
      color: ink,
    })
    gfx.setAlpha(1)
  }
}
