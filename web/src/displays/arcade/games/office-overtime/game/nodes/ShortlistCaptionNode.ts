// The caption above a shortlist: the floor glyph and its name. The inactive
// floor's caption dims (via the node's own alpha, which the render walk applies
// per node), reinforcing the reduced-alpha cards below it.

import { Node2D, textWidth, type Gfx2D } from '@src/stargazer'
import { COLORS } from '../tuning'
import { floorMark, icons } from '../../art/icons'
import type { Floor } from '../rules/deck'

const font = (weight: number, size: number): string =>
  `${weight} ${Math.max(1, size).toFixed(1)}px "Mozilla Text", system-ui, sans-serif`

/** The floor glyph SVGs are 17x20. */
const GLYPH_RATIO = 17 / 20

export class ShortlistCaptionNode extends Node2D {
  #w = 0
  #h = 0
  readonly #floor: Floor
  readonly #text: string

  constructor(id: string, floor: Floor, text: string) {
    super(id)
    this.renderLayer = 'dynamic'
    this.#floor = floor
    this.#text = text
  }

  setSize(w: number, h: number): void {
    this.#w = w
    this.#h = h
  }

  setActive(active: boolean): void {
    // Alpha does not cascade, but this node draws itself, so its own alpha is
    // honoured by the render walk.
    this.transform.alpha = active ? 1 : 0.4
  }

  override draw(gfx: Gfx2D): void {
    const w = this.#w
    const h = this.#h
    if (w <= 0 || h <= 0) return
    const set = icons()
    const glyphH = h * 0.72
    const glyphW = glyphH * GLYPH_RATIO
    const f = font(800, h * 0.52)
    const gap = h * 0.28
    const total = (set ? glyphW + gap : 0) + textWidth(this.#text, f)
    let x = w / 2 - total / 2
    if (set) {
      gfx.drawImage(
        floorMark(set, this.#floor),
        x,
        h / 2 - glyphH / 2,
        glyphW,
        glyphH,
      )
      x += glyphW + gap
    }
    gfx.fillText(this.#text, x, h / 2, {
      font: f,
      align: 'left',
      baseline: 'middle',
      color: COLORS.inkSoft,
    })
  }
}
