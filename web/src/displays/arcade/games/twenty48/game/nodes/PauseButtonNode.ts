/** The in-game pause toggle: the same slab as everything else, at HUD scale. */
import { ButtonBehavior, mixColor, Node2D, type Gfx2D } from '@src/stargazer'
import { BEVEL, COLORS } from '../tuning'
import { drawSlab } from './bevel'
import { drawPauseGlyph } from '../../../common/pauseGlyph'

const SIZE = 52

export class PauseButtonNode extends Node2D {
  #pressed = false

  constructor(onClick: () => void) {
    super('t48-pause-button')
    this.renderLayer = 'dynamic'
    this.debugBounds = { x: 0, y: 0, width: SIZE, height: SIZE * 1.2 }
    this.addBehavior(
      new ButtonBehavior({
        onClick,
        onPressedChange: (pressed) => (this.#pressed = pressed),
      }),
    )
  }

  /** So callers can center it without repeating the constant. */
  static get size(): number {
    return SIZE
  }

  override draw(gfx: Gfx2D): void {
    const depth = SIZE * 0.1
    const sink = this.#pressed ? depth * 0.7 : 0
    drawSlab(gfx, {
      x: 0,
      y: sink,
      w: SIZE,
      h: SIZE,
      radius: SIZE * 0.3,
      depth: depth - sink,
      face: COLORS.plate,
      skirt: mixColor(COLORS.plate, '#000000', BEVEL.skirtMix),
      highlight: mixColor(COLORS.plate, COLORS.white, BEVEL.highlightMix * 0.7),
      band: SIZE * 0.06,
    })
    drawPauseGlyph(gfx, SIZE / 2, sink + SIZE / 2, SIZE, COLORS.inkLight)
  }
}
