// The GPU backend's alpha/blend/clip-mask stack, snapshotted alongside the
// transform by `save`/`restore`.

import type { BitmapMask } from '../../../assets/BitmapMask'
import type { GfxBlend } from '../Gfx2D'

/**
 * Alpha + blend + clip mask, snapshotted by `save`/`restore` alongside the
 * transform. Absolute (Canvas `globalAlpha` semantics).
 */
export class StateStack {
  readonly #alpha: Float64Array
  readonly #blend: string[]
  readonly #clipMask: (BitmapMask | null)[]
  #top = 0

  constructor(capacity: number) {
    this.#alpha = new Float64Array(capacity)
    this.#blend = new Array(capacity)
    this.#clipMask = new Array(capacity)
    this.#alpha[0] = 1
    this.#blend[0] = 'source-over'
    this.#clipMask[0] = null
  }

  getAlpha(): number {
    return this.#alpha[this.#top]
  }
  setAlpha(a: number): void {
    this.#alpha[this.#top] = a
  }
  getBlend(): GfxBlend {
    return this.#blend[this.#top] as GfxBlend
  }
  setBlend(mode: GfxBlend): void {
    this.#blend[this.#top] = mode
  }
  getClipMask(): BitmapMask | null {
    return this.#clipMask[this.#top]
  }
  setClipMask(m: BitmapMask | null): void {
    this.#clipMask[this.#top] = m
  }

  push(): void {
    const nextTop = this.#top + 1
    if (nextTop >= this.#alpha.length) return
    this.#alpha[nextTop] = this.#alpha[this.#top]
    this.#blend[nextTop] = this.#blend[this.#top]
    this.#clipMask[nextTop] = this.#clipMask[this.#top]
    this.#top = nextTop
  }

  pop(): void {
    if (this.#top > 0) this.#top--
  }

  resetBase(): void {
    this.#top = 0
    this.#alpha[0] = 1
    this.#blend[0] = 'source-over'
    this.#clipMask[0] = null
  }
}
