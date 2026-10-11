import { postShader, type PostEffect, type PostPass } from '../PostEffect'
import type { ShaderReflection } from '../../gfx/GfxDevice'
import { parseColor } from '../../gfx/parseColor'
import wgsl from '../shaders/filmGrain.wgsl?raw'
import vertSrc from '../shaders/filmGrain.gen.vert.glsl?raw'
import fragSrc from '../shaders/filmGrain.gen.frag.glsl?raw'
import reflect from '../shaders/filmGrain.reflect.json'

/** Frame index wraps at this value, so the hash input stays small. */
const FRAME_WRAP = 1024

/** Construction overrides for {@link FilmGrain}. */
export interface FilmGrainOptions {
  enabled?: boolean
  /** Render-target pixels per grain cell. Default `2`. */
  cellPx?: number
  /** Fraction of cells that carry grain, `0`..`1`. Default `0.5`. */
  density?: number
  /** Blend strength of an "on" cell toward `tint`. Default `0.15`. */
  opacity?: number
  /** CSS color of the grain. Default `'#FCF5F0'`. */
  tint?: string
  /**
   * Grain refresh rate in Hz. Default `0`, a fixed pattern. Above `0` the
   * pattern re-rolls that many times a second, which reads as film grain on
   * moving footage and as crawling static on a still frame.
   */
  hz?: number
}

/**
 * Film grain: a scatter of tinted cells. An "on" cell blends `tint` in at
 * `opacity`, an "off" cell is untouched, so `opacity`/`density` at `0` leaves
 * the frame bit-identical to its input. One fullscreen pass.
 *
 * The pattern is fixed unless `hz` is raised. A still image under moving grain
 * reads as crawling static rather than as film, so animation is opt-in.
 *
 * @example
 *   engine.postProcess.add(new FilmGrain({ opacity: 0.1, cellPx: 2 }))
 */
export class FilmGrain implements PostEffect {
  enabled: boolean
  /** Render-target pixels per grain cell. Tweakable live. */
  cellPx: number
  /** Fraction of cells that carry grain. Tweakable live. */
  density: number
  /** Blend strength of an "on" cell. Tweakable live. */
  opacity: number
  /** CSS color of the grain. Tweakable live. */
  tint: string
  /** Grain refresh rate in Hz. `0` is a fixed pattern. Tweakable live. */
  hz: number
  readonly passes: readonly PostPass[]

  constructor(opts: FilmGrainOptions = {}) {
    this.enabled = opts.enabled ?? true
    this.cellPx = opts.cellPx ?? 2
    this.density = opts.density ?? 0.5
    this.opacity = opts.opacity ?? 0.15
    this.tint = opts.tint ?? '#FCF5F0'
    this.hz = opts.hz ?? 0
    this.passes = [
      {
        shader: postShader(vertSrc, fragSrc, wgsl, reflect as ShaderReflection),
        paramsBytes: 32, // vec4 p0 + vec4 tint
        writeParams: (ctx, out) => {
          out[0] = this.cellPx
          out[1] = this.density
          out[2] = this.opacity
          out[3] = this.hz > 0 ? Math.floor(ctx.time * this.hz) % FRAME_WRAP : 0
          const c = parseColor(this.tint)
          out[4] = c.r
          out[5] = c.g
          out[6] = c.b
        },
      },
    ]
  }
}
