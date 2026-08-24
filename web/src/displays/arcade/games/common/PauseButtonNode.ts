/**
 * A plain pause toggle for a game that has no chrome style of its own to match.
 *
 * Games with a distinctive look draw their own button and just borrow
 * {@link drawPauseGlyph} for the mark. This is for the rest: a rounded square, a
 * hairline border, and the shared mark, colored from whatever the game passes
 * in.
 *
 * Positioned in world units, so it suits a game that renders at the camera's
 * home framing. A game that pans or zooms needs screen-space chrome instead, or
 * the button drifts and scales with the view.
 *
 * @example
 *   const pause = new PauseButtonNode({ onClick: pauseGame, fill, ink })
 *   pause.setSize(48)
 *   chrome.add(pause)
 */
import { ButtonBehavior, Node2D, withAlpha, type Gfx2D } from '@src/stargazer'
import { drawPauseGlyph } from './pauseGlyph'

export interface PauseButtonOptions {
  onClick: () => void
  /** Button fill. */
  fill: string
  /** The mark, and the border it is drawn against. */
  ink: string
}

/** Corner radius, as a fraction of the button's side. */
const RADIUS_FRAC = 0.28
/** Border width, same basis. */
const BORDER_FRAC = 0.045

export class PauseButtonNode extends Node2D {
  readonly #opts: PauseButtonOptions
  #size = 0
  #pressed = false

  constructor(opts: PauseButtonOptions) {
    super('pause-button')
    this.#opts = opts
    this.renderLayer = 'dynamic'
    this.addBehavior(
      new ButtonBehavior({
        onClick: opts.onClick,
        onPressedChange: (pressed) => (this.#pressed = pressed),
      }),
    )
  }

  /** Set the side length. Also the hit rect, so this has to be called. */
  setSize(size: number): void {
    this.#size = size
    this.debugBounds = { x: 0, y: 0, width: size, height: size }
  }

  override draw(gfx: Gfx2D): void {
    const s = this.#size
    if (s <= 0) return
    const radius = s * RADIUS_FRAC
    const { fill, ink } = this.#opts

    gfx.fillRoundRect(0, 0, s, s, radius, fill)
    gfx.strokeRoundRect(0, 0, s, s, radius, {
      color: withAlpha(ink, this.#pressed ? 0.5 : 0.22),
      width: s * BORDER_FRAC,
    })
    drawPauseGlyph(gfx, s / 2, s / 2, s, ink)
  }
}
