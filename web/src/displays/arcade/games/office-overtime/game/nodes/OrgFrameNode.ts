// The empty-slot fills and drop placeholders, drawn under the cards. Empty cells
// in the org window show as light rounded slots; during a drag or tap-selection,
// every legal seat gets a faint card-shaped placeholder and the one under the
// pointer gets an accent outline.

import { Node2D, type Gfx2D, type Rect } from '@src/stargazer'
import { COLORS } from '../tuning'

export type FrameCell = {
  rect: Rect
  kind: 'slot' | 'placeholder' | 'hover'
}

/** Faint card-shaped placeholder, ~10% opacity. */
const PLACEHOLDER = '#0000001a'

export class OrgFrameNode extends Node2D {
  #cells: FrameCell[] = []
  #radius = 8

  constructor(id: string) {
    super(id)
    this.renderLayer = 'dynamic'
  }

  setCells(cells: FrameCell[], radius: number): void {
    this.#cells = cells
    this.#radius = radius
  }

  override draw(gfx: Gfx2D): void {
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
