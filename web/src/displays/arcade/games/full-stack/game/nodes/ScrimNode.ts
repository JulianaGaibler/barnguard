// A wash over the whole board, under whatever is being singled out.
//
// The DOM overlay sits above the canvas, so a scrim in HTML would dim the card
// it is meant to be lifting out. This one is a scene node, drawn between the
// board and the focus layer.

import { Node2D, type Canvas, type Rect } from '@src/stargazer'
import { COLORS } from '../tuning'

export class ScrimNode extends Node2D {
  #rect: Rect = { x: 0, y: 0, width: 0, height: 0 }

  constructor(id: string) {
    super(id)
  }

  setRect(rect: Rect): void {
    const r = this.#rect
    if (
      r.x === rect.x &&
      r.y === rect.y &&
      r.width === rect.width &&
      r.height === rect.height
    ) {
      return
    }
    this.#rect = rect
    this.markNeedsPaint()
  }

  override paint(gfx: Canvas): void {
    const r = this.#rect
    if (r.width <= 0 || r.height <= 0) return
    gfx.fillRect(r.x, r.y, r.width, r.height, COLORS.scrim)
  }
}
