/**
 * Fallback a path's drop shadow draws while its blurred mask is cold, starved,
 * or disabled: the path's own triangles, translated and tinted, with no blur.
 * `'hard'` is the only value. A `'none'` option was considered and rejected: it
 * makes a slow machine the one that shows missing shadows, which is worse than
 * a shadow that is merely sharper than it should be.
 */
export type PathShadowFallback = 'hard'

/** Snapped targets for {@link VectorQuality.shadowSigmaBudget}. */
export const SHADOW_SIGMA_BUDGETS = [4, 8, 12] as const

function nearestAllowed(value: number, allowed: readonly number[]): number {
  let best = allowed[0]
  for (const a of allowed) {
    if (Math.abs(a - value) < Math.abs(best - value)) best = a
  }
  return best
}

/** Construction overrides for {@link VectorQuality}. */
export interface VectorQualityOptions {
  pathShadowsEnabled?: boolean
  shadowSigmaBudget?: number
  shadowExtentSigmas?: number
  shadowMaskBudgetBytes?: number
  shadowBakeWorkPerFrame?: number
  analyticShadowFrame?: boolean
  dither?: boolean
}

/**
 * Live quality settings for the 2D vector renderer: path drop shadows and
 * gradient dithering. One instance lives on the engine, as
 * `engine.quality.vector`. The renderer reads it each frame, so changes take
 * effect immediately.
 *
 * @example
 *   engine.quality.vector.shadowSigmaBudget = 4 // cheaper, softer path shadows
 *   engine.quality.vector.dither = false // flat gradients, e.g. for a screenshot diff
 */
export class VectorQuality {
  /** Master switch for path drop shadows (the cached-mask kind). Default `true`. */
  pathShadowsEnabled: boolean
  /** @see PathShadowFallback */
  readonly pathShadowFallback: PathShadowFallback = 'hard'
  #shadowSigmaBudget = 8
  /**
   * How far a path shadow's mask extends past its silhouette, in multiples of
   * its own sigma. Below 3 the blur kernel reaches past the padding and an
   * opaque shadow shows a faint ring at its bounding box. Default `3`.
   */
  shadowExtentSigmas: number
  /**
   * Byte budget for every path-shadow mask alive at once, retained masks and
   * the transient render-target pool combined (the pool runs roughly 3x the
   * retained bytes). Default 48 MB.
   */
  shadowMaskBudgetBytes: number
  /**
   * Per-frame bake budget, in blur tap-work (mask texels times tap count, not
   * texel count alone: cost scales with both). Consumed starting with the mask
   * bake scheduler; the default is a placeholder order of magnitude until that
   * scheduler's own measurements tune it.
   */
  shadowBakeWorkPerFrame: number
  /**
   * Draw an opaque outset shadow as a frame of four instances over the border
   * region instead of a full quad. Default `true`.
   */
  analyticShadowFrame: boolean
  /**
   * Ordered dither on an 8-bit ramp: a gradient fill, an analytic shadow, and
   * the outset path-shadow composite. Never applied under `'lighter'` blend
   * (the per-draw offset would sum instead of averaging out) or to a solid fill
   * (nothing to band). Default `true`.
   */
  dither: boolean

  constructor(opts: VectorQualityOptions = {}) {
    this.pathShadowsEnabled = opts.pathShadowsEnabled ?? true
    this.shadowSigmaBudget = opts.shadowSigmaBudget ?? 8
    this.shadowExtentSigmas = opts.shadowExtentSigmas ?? 3
    this.shadowMaskBudgetBytes = opts.shadowMaskBudgetBytes ?? 48 * 1024 * 1024
    this.shadowBakeWorkPerFrame = opts.shadowBakeWorkPerFrame ?? 4_000_000
    this.analyticShadowFrame = opts.analyticShadowFrame ?? true
    this.dither = opts.dither ?? true
  }

  /**
   * Blur-kernel sigma budget in device px (snapped to
   * {@link SHADOW_SIGMA_BUDGETS}).
   */
  get shadowSigmaBudget(): number {
    return this.#shadowSigmaBudget
  }
  set shadowSigmaBudget(v: number) {
    this.#shadowSigmaBudget = nearestAllowed(v, SHADOW_SIGMA_BUDGETS)
  }
}
