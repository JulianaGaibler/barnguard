/**
 * One half of a two-way wall: a single segment that extends from an anchor (the
 * seed cell center) in one direction. The two halves of a placed wall grow,
 * solidify, and are destroyed independently — a ball hitting one half removes
 * only that half while the other keeps going — so each is its own node. The
 * anchored side is pinned at the seed center, giving the placed wall its
 * two-tone split there (primary on one half, variant on the other).
 */
import { SceneNode, type Gfx2D } from '@src/stargazer'
import type { Bounds, Orientation } from '../types'

export class WallSegmentNode extends SceneNode {
  readonly #anchorX: number
  readonly #anchorY: number
  readonly #halfThick: number
  readonly #orientation: Orientation
  readonly #dir: -1 | 1
  readonly #color: string
  #len = 0

  constructor(
    anchorX: number,
    anchorY: number,
    halfThick: number,
    orientation: Orientation,
    dir: -1 | 1,
    color: string,
  ) {
    super('wall-segment')
    this.#anchorX = anchorX
    this.#anchorY = anchorY
    this.#halfThick = halfThick
    this.#orientation = orientation
    this.#dir = dir
    this.#color = color
    this.renderLayer = 'dynamic'
  }

  setLength(len: number): void {
    this.#len = len
  }

  currentRect(): Bounds {
    const t = this.#halfThick
    const len = this.#len
    if (this.#orientation === 'vertical') {
      const y = this.#dir < 0 ? this.#anchorY - len : this.#anchorY
      return { x: this.#anchorX - t, y, width: t * 2, height: len }
    }
    const x = this.#dir < 0 ? this.#anchorX - len : this.#anchorX
    return { x, y: this.#anchorY - t, width: len, height: t * 2 }
  }

  override draw(gfx: Gfx2D): void {
    const r = this.currentRect()
    if (r.width > 0 && r.height > 0)
      gfx.fillRect(r.x, r.y, r.width, r.height, this.#color)
  }
}
