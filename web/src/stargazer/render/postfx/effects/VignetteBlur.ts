import type { PostEffect, PostPass } from '../PostEffect'
import fragSrc from '../shaders/blur.frag.glsl?raw'

/** Construction overrides for {@link VignetteBlur}. */
export interface VignetteBlurOptions {
  enabled?: boolean
  /** Max blur reach in texels at the edges. Default `4`. */
  strength?: number
  /** Distance from center (uv) where blur begins. Default `0.55`. */
  radius?: number
  /** Falloff band width. Default `0.45`. */
  softness?: number
}

/**
 * Edge-weighted blur: the image stays sharp in the center and blurs toward the
 * periphery, a focus/lens look that pairs with {@link Vignette}. Two fullscreen
 * passes (separable horizontal then vertical Gaussian), each modulated by the
 * same radial mask.
 *
 * @category Render
 * @example
 *   engine.postProcess.add(new VignetteBlur({ strength: 6, radius: 0.5 }))
 */
export class VignetteBlur implements PostEffect {
  enabled: boolean
  /** Max blur reach in texels at the edges; tweakable live. */
  strength: number
  /** Distance from center (uv) where blur begins; tweakable live. */
  radius: number
  /** Falloff band width; tweakable live. */
  softness: number
  readonly passes: readonly PostPass[]

  constructor(opts: VignetteBlurOptions = {}) {
    this.enabled = opts.enabled ?? true
    this.strength = opts.strength ?? 4
    this.radius = opts.radius ?? 0.55
    this.softness = opts.softness ?? 0.45
    // Horizontal then vertical; the pipeline runs them in order, so the second
    // blurs the first's output — a separable 2D Gaussian.
    this.passes = [this.#axisPass('h'), this.#axisPass('v')]
  }

  #axisPass(axis: 'h' | 'v'): PostPass {
    return {
      fragmentSrc: fragSrc,
      paramsBytes: 32, // vec4 u_p0 + vec4 u_p1
      writeParams: (ctx, out) => {
        // u_p0 = (dirX, dirY, radius, softness); u_p1.x = strength.
        out[0] = axis === 'h' ? ctx.texelW : 0
        out[1] = axis === 'h' ? 0 : ctx.texelH
        out[2] = this.radius
        out[3] = this.softness
        out[4] = this.strength
      },
    }
  }
}
