/**
 * Live rendering-quality settings for the 3D pass. One instance lives on the
 * {@link Engine} (`engine.quality`); the renderer reads it each frame, so
 * changes take effect immediately. Setters clamp to supported values and bump
 * {@link RenderQuality.revision}, which the renderer watches to rebuild
 * size-dependent GPU resources (the shadow maps).
 *
 * @category Render
 * @example
 *   engine.quality.shadowMapSize = 2048 // sharper shadows
 *   engine.quality.shadowsEnabled = false // drop shadows on a weak GPU
 */

/** Supported shadow-map edge sizes, in pixels. */
export const SHADOW_MAP_SIZES = [256, 512, 1024, 2048, 4096] as const
/** Supported PCF tap counts (shadow-edge softness); 1 is hard. */
export const SHADOW_SOFTNESS_TAPS = [1, 4, 9, 16] as const

/** Construction overrides for {@link RenderQuality}. */
export interface RenderQualityOptions {
  shadowMapSize?: number
  shadowsEnabled?: boolean
  anisotropy?: number
  shadowSoftness?: number
}

function nearestAllowed(value: number, allowed: readonly number[]): number {
  let best = allowed[0]
  for (const a of allowed) {
    if (Math.abs(a - value) < Math.abs(best - value)) best = a
  }
  return best
}

export class RenderQuality {
  #shadowMapSize = 1024
  #shadowsEnabled = true
  #anisotropy = 8
  #shadowSoftness = 4
  #revision = 0

  constructor(opts: RenderQualityOptions = {}) {
    if (opts.shadowMapSize !== undefined)
      this.shadowMapSize = opts.shadowMapSize
    if (opts.shadowsEnabled !== undefined)
      this.shadowsEnabled = opts.shadowsEnabled
    if (opts.anisotropy !== undefined) this.anisotropy = opts.anisotropy
    if (opts.shadowSoftness !== undefined)
      this.shadowSoftness = opts.shadowSoftness
    this.#revision = 0
  }

  /** Bumped whenever a setting changes, so the renderer can react. */
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
  get shadowsEnabled(): boolean {
    return this.#shadowsEnabled
  }
  set shadowsEnabled(v: boolean) {
    if (v !== this.#shadowsEnabled) {
      this.#shadowsEnabled = v
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
   * Shadow PCF tap count (snapped to {@link SHADOW_SOFTNESS_TAPS}); 1 = hard
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
