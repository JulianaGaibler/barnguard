import type { PostEffect, PostPass } from '../PostEffect'
import fragSrc from '../shaders/chromaticAberration.frag.glsl?raw'

/** Construction overrides for {@link ChromaticAberration}. */
export interface ChromaticAberrationOptions {
  enabled?: boolean
  /** Peak channel separation (uv units) at the corners. Default `0.006`. */
  amount?: number
}

/**
 * Radial chromatic aberration: splits the red/blue channels outward from the
 * center, growing toward the edges, for a lens-fringe look. One fullscreen
 * pass.
 *
 * @category Render
 * @example
 *   engine.postProcess.add(new ChromaticAberration({ amount: 0.01 }))
 */
export class ChromaticAberration implements PostEffect {
  enabled: boolean
  /** Peak channel separation (uv units) at the corners; tweakable live. */
  amount: number
  readonly passes: readonly PostPass[]

  constructor(opts: ChromaticAberrationOptions = {}) {
    this.enabled = opts.enabled ?? true
    this.amount = opts.amount ?? 0.006
    this.passes = [
      {
        fragmentSrc: fragSrc,
        paramsBytes: 16, // vec4 u_ca
        writeParams: (_ctx, out) => {
          out[0] = this.amount
        },
      },
    ]
  }
}
