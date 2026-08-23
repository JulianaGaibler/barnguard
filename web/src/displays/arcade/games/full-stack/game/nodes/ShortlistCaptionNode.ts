// The marker above a shortlist: the floor's own glyph, and nothing else. The
// two floors already read as their marks on every card in the row below, so a
// name here says the same thing twice at the width the strip has.
//
// The inactive floor's caption dims via the node's own alpha, which the render
// walk applies per node, reinforcing the faded cards below it. Alpha is enough
// here where a card needs a veil, because there is only one thing drawn, so
// nothing shows through anything else.

import { Node2D, type Gfx2D } from '@src/stargazer'
import { drawIcon, floorMark, iconWidth, icons } from '../../art/icons'
import type { Floor } from '../rules/deck'

export class ShortlistCaptionNode extends Node2D {
  #w = 0
  #h = 0
  readonly #floor: Floor

  constructor(id: string, floor: Floor) {
    super(id)
    this.renderLayer = 'dynamic'
    this.#floor = floor
  }

  setSize(w: number, h: number): void {
    this.#w = w
    this.#h = h
  }

  setActive(active: boolean): void {
    this.transform.alpha = active ? 1 : 0.4
  }

  override draw(gfx: Gfx2D): void {
    const w = this.#w
    const h = this.#h
    if (w <= 0 || h <= 0) return
    const set = icons()
    if (!set) return
    // Hung from the top of the strip, so the rest of it reads as the gap
    // between the marker and the row it marks.
    const glyph = floorMark(set, this.#floor)
    const glyphH = h * 0.6
    drawIcon(gfx, glyph, w / 2 - iconWidth(glyph, glyphH) / 2, 0, glyphH)
  }
}
