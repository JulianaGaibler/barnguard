/**
 * The in-game pause toggle — engine port of the `.pause-btn` overlay: a
 * small bordered square with a static "II" glyph. Its fill matches the page
 * background (only the border + glyph read against it), same as the original.
 */
import { SceneNode, type Gfx2D } from '@src/stargazer'
import { COLORS } from '../tuning'

const SIZE = 38.4 // 2.4rem
const RADIUS = 6.4 // 0.4rem
const PRESS_FILL = 'rgba(39, 39, 39, 0.08)'
const FONT_FAMILY = 'system-ui, sans-serif'

export class PauseButtonNode extends SceneNode {
  readonly #onClick: () => void
  #pressed = false

  constructor(onClick: () => void) {
    super('jb-pause-button')
    this.renderLayer = 'dynamic'
    this.#onClick = onClick

    this.debugBounds = { x: 0, y: 0, width: SIZE, height: SIZE }
    this.hitEnabled = true
    this.onPointerDown = (): void => {
      this.#pressed = true
    }
    this.onPointerUp = (e): void => {
      const wasPressed = this.#pressed
      this.#pressed = false
      if (wasPressed && this.hitTest(e.pointer.world.x, e.pointer.world.y, 0)) {
        this.#onClick()
      }
    }
    this.onPointerCancel = (): void => {
      this.#pressed = false
    }
  }

  override draw(gfx: Gfx2D): void {
    gfx.fillRoundRect(0, 0, SIZE, SIZE, RADIUS, this.#pressed ? PRESS_FILL : COLORS.background)
    gfx.strokeRoundRect(0, 0, SIZE, SIZE, RADIUS, { color: COLORS.ink, width: 2 })
    gfx.fillText('II', SIZE / 2, SIZE / 2, {
      font: `900 13.6px ${FONT_FAMILY}`,
      align: 'center',
      baseline: 'middle',
      color: COLORS.ink,
    })
  }
}
