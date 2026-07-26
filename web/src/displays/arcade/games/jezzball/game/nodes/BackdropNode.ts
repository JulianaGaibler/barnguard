/**
 * Flat full-bleed backdrop that covers the arcade's animated sky within the
 * game region, giving JezzBall its solid light background. Sits on the dynamic
 * layer and is added to the scene before the boards so it paints over the sky
 * but under the play content.
 */
import { Node2D, type Gfx2D } from '@src/stargazer'
import type { Bounds } from '../types'
import { COLORS } from '../tuning'

export class BackdropNode extends Node2D {
  #rect: Bounds

  constructor(rect: Bounds) {
    super('jezzball-backdrop')
    this.#rect = rect
    this.renderLayer = 'dynamic'
  }

  setRect(rect: Bounds): void {
    this.#rect = rect
  }

  override draw(gfx: Gfx2D): void {
    const r = this.#rect
    gfx.fillRect(r.x, r.y, r.width, r.height, COLORS.background)
  }
}
