// The GPU backend's alpha/blend/clip stack, snapshotted alongside the transform
// by `save`/`restore`.

import type { BitmapMask } from '../../assets/BitmapMask'
import type { GfxBlend } from './Gfx2D'

/**
 * An analytic clip shape resolved to device px (a snapshot of the shape under
 * the transform active when `setClip` ran). `kind` 1 = circle, 2 =
 * rounded-rect. The renderer feeds these fields to the shared clip UBO; the
 * fragment stage evaluates an SDF against them. Reference identity drives batch
 * breaks, so a fresh object per `setClip` is intentional.
 */
export interface ResolvedClip {
  kind: 1 | 2
  cx: number
  cy: number
  /** Circle radius (device px). */
  r: number
  /** Rounded-rect half extents + corner radius (device px). */
  halfW: number
  halfH: number
  rrRadius: number
}

/**
 * Alpha + blend + clip mask + analytic clip, snapshotted by `save`/`restore`
 * alongside the transform. Absolute (Canvas `globalAlpha` semantics).
 */
export class StateStack {
  readonly #alpha: Float64Array
  readonly #blend: string[]
  readonly #clipMask: (BitmapMask | null)[]
  readonly #clip: (ResolvedClip | null)[]
  #top = 0

  constructor(capacity: number) {
    this.#alpha = new Float64Array(capacity)
    this.#blend = new Array(capacity)
    this.#clipMask = new Array(capacity)
    this.#clip = new Array(capacity)
    this.#alpha[0] = 1
    this.#blend[0] = 'source-over'
    this.#clipMask[0] = null
    this.#clip[0] = null
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
  getClip(): ResolvedClip | null {
    return this.#clip[this.#top]
  }
  setClip(c: ResolvedClip | null): void {
    this.#clip[this.#top] = c
  }

  push(): void {
    const nextTop = this.#top + 1
    if (nextTop >= this.#alpha.length) return
    this.#alpha[nextTop] = this.#alpha[this.#top]
    this.#blend[nextTop] = this.#blend[this.#top]
    this.#clipMask[nextTop] = this.#clipMask[this.#top]
    this.#clip[nextTop] = this.#clip[this.#top]
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
    this.#clip[0] = null
  }
}
