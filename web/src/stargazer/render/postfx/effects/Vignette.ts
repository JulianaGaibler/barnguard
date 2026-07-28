import type { PostEffect, PostPass } from '../PostEffect'
import fragSrc from '../shaders/vignette.frag.glsl?raw'

/** Construction overrides for {@link Vignette}. */
export interface VignetteOptions {
  enabled?: boolean
  /** Corner darkening, `0` (off) to `1` (black). Default `0.5`. */
  intensity?: number
  /** Distance from center (uv) where darkening begins. Default `0.5`. */
  radius?: number
  /** Falloff band width. Default `0.45`. */
  softness?: number
}

/**
 * Darkens the frame toward its edges by a smooth radial falloff. One fullscreen
 * pass; premultiplied-safe (a scalar multiply).
 *
 * @category Render
 * @example
 *   engine.postProcess.add(new Vignette({ intensity: 0.6, radius: 0.4 }))
 */
export class Vignette implements PostEffect {
  enabled: boolean
  /** Corner darkening, `0`..`1`; tweakable live. */
  intensity: number
  /** Distance from center (uv) where darkening begins; tweakable live. */
  radius: number
  /** Falloff band width; tweakable live. */
  softness: number
  readonly passes: readonly PostPass[]

  constructor(opts: VignetteOptions = {}) {
    this.enabled = opts.enabled ?? true
    this.intensity = opts.intensity ?? 0.5
    this.radius = opts.radius ?? 0.5
    this.softness = opts.softness ?? 0.45
    this.passes = [
      {
        fragmentSrc: fragSrc,
        paramsBytes: 16, // vec4 u_vig
        writeParams: (_ctx, out) => {
          out[0] = this.intensity
          out[1] = this.radius
          out[2] = this.softness
        },
      },
    ]
  }
}
