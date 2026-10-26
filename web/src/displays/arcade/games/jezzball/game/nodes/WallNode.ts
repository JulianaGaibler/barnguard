/**
 * One half of a two-way wall: a single segment that extends from an anchor (the
 * seed cell center) in one direction. The two halves of a placed wall grow,
 * solidify, and are destroyed independently. A ball hitting one half removes
 * only that half while the other keeps going, so each is its own node. The
 * anchored side is pinned at the seed center, giving the placed wall its
 * two-tone split there (primary on one half, variant on the other).
 */
import { Node2D, type Canvas } from 'stargazer'
import type { Bounds, Orientation } from '../types'

export class WallSegmentNode extends Node2D {
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
    this.visible = false
  }

  /** The segment is a unit square that the node's transform stretches. */
  setLength(len: number): void {
    this.#len = len
    const r = this.currentRect()
    const t = this.transform
    t.x = r.x
    t.y = r.y
    t.scaleX = r.width
    t.scaleY = r.height
    this.visible = r.width > 0 && r.height > 0
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

  override paint(gfx: Canvas): void {
    gfx.fillRect(0, 0, 1, 1, this.#color)
  }
}
