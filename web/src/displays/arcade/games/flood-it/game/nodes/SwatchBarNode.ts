/**
 * The color buttons, which are the game's only control.
 *
 * One {@link SwatchNode} per color, sized and placed by a {@link SwatchBarNode}
 * that owns the row. Each swatch is its own node so it can carry a
 * `ButtonBehavior` and be hit-tested on its own rect, which is what a large
 * touchscreen needs: the targets are as big as the row allows and nothing has
 * to work out which button a finger landed on.
 *
 * A row can be dimmed whole, for the player who is not up in the contest.
 */
import { ButtonBehavior, easings, Node2D, type Gfx2D } from '@src/stargazer'
import { swatchRect } from '../layout'
import { ANIM, CELL_COLORS, CELL_GLYPHS, GEOM, GLYPH_INKS } from '../tuning'
import type { Bounds, Color } from '../types'
import { drawGlyph } from './glyphs'

class SwatchNode extends Node2D {
  readonly #color: Color
  #width = 0
  #height = 0
  #pressed = 0
  #ring = 1
  #glyphT = 0

  glyphsOn = false
  /** Dimmed and inert, for the row whose player is not up. */
  active = true

  constructor(color: Color, onPick: (color: Color) => void) {
    super(`flood-swatch-${color}`)
    this.#color = color
    this.renderLayer = 'dynamic'
    this.addBehavior(
      new ButtonBehavior({
        onClick: () => {
          this.#ring = 0
          onPick(color)
        },
        enabled: () => this.active,
        onPressedChange: (pressed) => (this.#pressedTarget = pressed),
      }),
    )
  }

  #pressedTarget = false

  setRect(rect: Bounds): void {
    this.transform.x = rect.x
    this.transform.y = rect.y
    this.#width = rect.width
    this.#height = rect.height
    this.debugBounds = { x: 0, y: 0, width: rect.width, height: rect.height }
  }

  override onUpdate(dt: number): void {
    const target = this.#pressedTarget ? 1 : 0
    const step = dt / ANIM.swatchPress
    this.#pressed =
      this.#pressed < target
        ? Math.min(target, this.#pressed + step)
        : Math.max(target, this.#pressed - step)

    if (this.#ring < 1) {
      this.#ring = Math.min(1, this.#ring + dt / ANIM.swatchRing)
    }

    const glyphTarget = this.glyphsOn ? 1 : 0
    const glyphStep = dt / ANIM.glyphFade
    this.#glyphT =
      this.#glyphT < glyphTarget
        ? Math.min(glyphTarget, this.#glyphT + glyphStep)
        : Math.max(glyphTarget, this.#glyphT - glyphStep)
  }

  override draw(gfx: Gfx2D): void {
    const w = this.#width
    const h = this.#height
    if (w <= 0 || h <= 0) return

    // Press reads as a shrink toward the centre, so the finger looks like it is
    // pushing the button rather than covering a color change.
    const shrink = this.#pressed * h * 0.05
    const x = shrink
    const y = shrink
    const bw = w - shrink * 2
    const bh = h - shrink * 2
    const radius = h * GEOM.swatchRadiusFrac
    const color = CELL_COLORS[this.#color]!

    if (!this.active) gfx.setAlpha(0.32)

    if (this.#ring < 1) {
      // One ring thrown outward on release, confirming which button took the
      // tap even when the board is busy flooding.
      const t = easings.outQuad(this.#ring)
      const grow = h * 0.34 * t
      gfx.setAlpha((this.active ? 1 : 0.32) * (1 - t) * 0.7)
      gfx.strokeRoundRect(
        x - grow,
        y - grow,
        bw + grow * 2,
        bh + grow * 2,
        radius + grow,
        { color, width: h * 0.06 },
      )
      gfx.setAlpha(this.active ? 1 : 0.32)
    }

    gfx.fillRoundRect(x, y, bw, bh, radius, color)

    if (this.#glyphT > 0.01) {
      // Scaled in rather than faded in, so the glyph is always drawn opaque and
      // its overlapping passes never show a seam.
      drawGlyph(
        gfx,
        CELL_GLYPHS[this.#color]!,
        x + bw / 2,
        y + bh / 2,
        Math.min(bw, bh) * 0.52 * easings.outBack(this.#glyphT),
        GLYPH_INKS[this.#color]!,
      )
    }
    gfx.setAlpha(1)
  }
}

export class SwatchBarNode extends Node2D {
  readonly #swatches: SwatchNode[] = []

  constructor(numColors: number, onPick: (color: Color) => void) {
    super('flood-swatch-bar')
    for (let c = 0; c < numColors; c++) {
      const swatch = new SwatchNode(c, onPick)
      this.#swatches.push(swatch)
      this.add(swatch)
    }
  }

  /** Lay the row out inside `rect`. */
  setRect(rect: Bounds): void {
    const count = this.#swatches.length
    this.#swatches.forEach((swatch, i) => {
      swatch.setRect(swatchRect(rect, count, i))
    })
  }

  /** Show or hide the shape overlay on every button. */
  setGlyphs(on: boolean): void {
    for (const swatch of this.#swatches) swatch.glyphsOn = on
  }

  /**
   * Whether this row's player may act. A dimmed row is also inert, so a tap on
   * the wrong side of the contest cannot reach the rules.
   */
  setActive(active: boolean): void {
    for (const swatch of this.#swatches) swatch.active = active
  }
}
