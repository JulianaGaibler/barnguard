// The GPU backend's alpha/blend/clip stack, snapshotted alongside the transform
// by `save`/`restore`.

import type { BitmapMask } from '../../assets/BitmapMask'
import type { GfxBlend } from './Gfx2D'

/**
 * An analytic clip shape, as a snapshot of the shape under the transform active
 * when `setClip` ran. `kind` 1 = circle, 2 = rounded-rect.
 *
 * It carries two forms. The programs that read the clip from the per-run clip
 * UBO use the device-space form (`cx`, `cy`, `r`, `halfW`, `halfH`, `radii`),
 * which approximates a circle under a non-uniform scale and a rounded rect
 * under rotation. The programs that read it from the param table use the exact
 * form: the shape in local space (`l*`) and the inverse of the transform
 * (`ia`..`if`), which maps a device pixel back into local space. Batches
 * compare clips with {@link clipEquals}, so a fresh object per `setClip` does
 * not break a run.
 */
export interface ResolvedClip {
  kind: 1 | 2
  cx: number
  cy: number
  /** Circle radius (device px). */
  r: number
  /** Rounded-rect half extents (device px). */
  halfW: number
  halfH: number
  /** Rounded-rect corner radii, clockwise from the top left (device px). */
  radii: readonly [number, number, number, number]
  /**
   * The shape in local space: centre, circle radius, half extents, and corner
   * radii clockwise from the top left.
   */
  lcx: number
  lcy: number
  lr: number
  lhalfW: number
  lhalfH: number
  lradii: readonly [number, number, number, number]
  /** Device to local affine: `x' = ia*x + ic*y + ie`, `y' = ib*x + id*y + if`. */
  ia: number
  ib: number
  ic: number
  id: number
  ie: number
  if: number
}

function sameRadii(
  a: readonly [number, number, number, number],
  b: readonly [number, number, number, number],
): boolean {
  return a[0] === b[0] && a[1] === b[1] && a[2] === b[2] && a[3] === b[3]
}

/** Whether two resolved clips describe the same shape. */
export function clipEquals(
  a: ResolvedClip | null,
  b: ResolvedClip | null,
): boolean {
  if (a === b) return true
  if (a === null || b === null) return false
  return (
    a.kind === b.kind &&
    a.cx === b.cx &&
    a.cy === b.cy &&
    a.r === b.r &&
    a.halfW === b.halfW &&
    a.halfH === b.halfH &&
    sameRadii(a.radii, b.radii) &&
    a.lcx === b.lcx &&
    a.lcy === b.lcy &&
    a.lr === b.lr &&
    a.lhalfW === b.lhalfW &&
    a.lhalfH === b.lhalfH &&
    sameRadii(a.lradii, b.lradii) &&
    a.ia === b.ia &&
    a.ib === b.ib &&
    a.ic === b.ic &&
    a.id === b.id &&
    a.ie === b.ie &&
    a.if === b.if
  )
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
