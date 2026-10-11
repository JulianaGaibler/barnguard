import { VectorQuality, type VectorQualityOptions } from './VectorQuality'

/** Supported shadow-map edge sizes, in pixels. */
export const SHADOW_MAP_SIZES = [256, 512, 1024, 2048, 4096] as const
/** Supported PCF tap counts (shadow-edge softness). 1 is hard. */
export const SHADOW_SOFTNESS_TAPS = [1, 4, 9, 16] as const

/** Construction overrides for {@link RenderQuality}. */
export interface RenderQualityOptions {
  shadowMapSize?: number
  meshShadowsEnabled?: boolean
  anisotropy?: number
  shadowSoftness?: number
  vector?: VectorQualityOptions
}

function nearestAllowed(value: number, allowed: readonly number[]): number {
  let best = allowed[0]
  for (const a of allowed) {
    if (Math.abs(a - value) < Math.abs(best - value)) best = a
  }
  return best
}

/**
 * Live rendering-quality settings for the 3D pass. One instance lives on the
 * engine, as `engine.quality`. The renderer reads it each frame, so changes
 * take effect immediately. Setters clamp to supported values.
 *
 * @example
 *   engine.quality.shadowMapSize = 2048 // sharper shadows
 *   engine.quality.meshShadowsEnabled = false // drop shadows on a weak GPU
 */
export class RenderQuality {
  #shadowMapSize = 1024
  #meshShadowsEnabled = true
  #anisotropy = 8
  #shadowSoftness = 4
  #revision = 0
  /** 2D vector-renderer quality: path drop shadows and gradient dithering. */
  readonly vector: VectorQuality

  constructor(opts: RenderQualityOptions = {}) {
    if (opts.shadowMapSize !== undefined)
      this.shadowMapSize = opts.shadowMapSize
    if (opts.meshShadowsEnabled !== undefined)
      this.meshShadowsEnabled = opts.meshShadowsEnabled
    if (opts.anisotropy !== undefined) this.anisotropy = opts.anisotropy
    if (opts.shadowSoftness !== undefined)
      this.shadowSoftness = opts.shadowSoftness
    this.vector = new VectorQuality(opts.vector)
    this.#revision = 0
  }

  /**
   * Bumped whenever a setting changes. Nothing in the renderer reads this:
   * `MeshRenderer` rebuilds its shadow map by comparing the resolved size
   * against its own cached value instead. Kept for a consumer that wants to
   * detect "something changed" without diffing every field, not as a signal
   * the engine itself watches.
   */
  get revision(): number {
    return this.#revision
  }

  /** Shadow-map edge size in pixels (snapped to {@link SHADOW_MAP_SIZES}). */
  get shadowMapSize(): number {
    return this.#shadowMapSize
  }
  set shadowMapSize(v: number) {
    const snapped = nearestAllowed(v, SHADOW_MAP_SIZES)
    if (snapped !== this.#shadowMapSize) {
      this.#shadowMapSize = snapped
      this.#revision++
    }
  }

  /**
   * Master switch for the shadow passes (per-light `shadowEnabled` still gates
   * individually).
   */
  get meshShadowsEnabled(): boolean {
    return this.#meshShadowsEnabled
  }
  set meshShadowsEnabled(v: boolean) {
    if (v !== this.#meshShadowsEnabled) {
      this.#meshShadowsEnabled = v
      this.#revision++
    }
  }

  /** Anisotropic-filtering level for glTF textures (clamped to `1..16`). */
  get anisotropy(): number {
    return this.#anisotropy
  }
  set anisotropy(v: number) {
    const clamped = Math.max(1, Math.min(16, Math.round(v)))
    if (clamped !== this.#anisotropy) {
      this.#anisotropy = clamped
      this.#revision++
    }
  }

  /**
   * Shadow PCF tap count (snapped to {@link SHADOW_SOFTNESS_TAPS}). 1 is hard
   * edges.
   */
  get shadowSoftness(): number {
    return this.#shadowSoftness
  }
  set shadowSoftness(v: number) {
    const snapped = nearestAllowed(v, SHADOW_SOFTNESS_TAPS)
    if (snapped !== this.#shadowSoftness) {
      this.#shadowSoftness = snapped
      this.#revision++
    }
  }
}
