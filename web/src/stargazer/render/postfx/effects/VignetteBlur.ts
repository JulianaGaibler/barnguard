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
      bind: (device, program, ctx) => {
        if (axis === 'h') device.setUniform2f(program, 'u_dir', ctx.texelW, 0)
        else device.setUniform2f(program, 'u_dir', 0, ctx.texelH)
        device.setUniform1f(program, 'u_radius', this.radius)
        device.setUniform1f(program, 'u_softness', this.softness)
        device.setUniform1f(program, 'u_strength', this.strength)
      },
    }
  }
}
