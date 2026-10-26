// The empty-slot fills and drop placeholders, drawn under the cards. Empty cells
// in the org window show as light rounded slots. During a drag or tap-selection,
// every legal seat gets a faint card-shaped placeholder and the one under the
// pointer gets an accent outline.

import { Node2D, type Canvas, type Rect } from 'stargazer'
import { COLORS } from '../tuning'

export type FrameCell = {
  rect: Rect
  kind: 'slot' | 'placeholder' | 'hover'
}

/** Faint card-shaped placeholder, ~10% opacity. */
const PLACEHOLDER = '#0000001a'

function sameCells(a: readonly FrameCell[], b: readonly FrameCell[]): boolean {
  return (
    a.length === b.length &&
    a.every((c, i) => {
      const o = b[i]!
      return (
        c.kind === o.kind &&
        c.rect.x === o.rect.x &&
        c.rect.y === o.rect.y &&
        c.rect.width === o.rect.width &&
        c.rect.height === o.rect.height
      )
    })
  )
}

export class OrgFrameNode extends Node2D {
  #cells: FrameCell[] = []
  #radius = 8

  constructor(id: string) {
    super(id)
  }

  setCells(cells: FrameCell[], radius: number): void {
    if (radius === this.#radius && sameCells(this.#cells, cells)) return
    this.#cells = cells
    this.#radius = radius
    this.markNeedsPaint()
  }

  override paint(gfx: Canvas): void {
    for (const c of this.#cells) {
      const { x, y, width, height } = c.rect
      if (c.kind === 'slot') {
        gfx.fillRoundRect(x, y, width, height, this.#radius, COLORS.slotEmpty)
      } else if (c.kind === 'placeholder') {
        gfx.fillRoundRect(x, y, width, height, this.#radius, PLACEHOLDER)
      } else {
        gfx.strokeRoundRect(x, y, width, height, this.#radius, {
          color: COLORS.activeSide,
          width: Math.max(2, width * 0.02),
        })
      }
    }
  }
}
