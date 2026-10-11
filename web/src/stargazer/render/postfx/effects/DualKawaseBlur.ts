import { postShader, type PostEffect, type PostPass } from '../PostEffect'
import type { ShaderReflection } from '../../gfx/GfxDevice'
import downWgsl from '../shaders/dualKawaseDown.wgsl?raw'
import downVertSrc from '../shaders/dualKawaseDown.gen.vert.glsl?raw'
import downFragSrc from '../shaders/dualKawaseDown.gen.frag.glsl?raw'
import downReflect from '../shaders/dualKawaseDown.reflect.json'
import upWgsl from '../shaders/dualKawaseUp.wgsl?raw'
import upVertSrc from '../shaders/dualKawaseUp.gen.vert.glsl?raw'
import upFragSrc from '../shaders/dualKawaseUp.gen.frag.glsl?raw'
import upReflect from '../shaders/dualKawaseUp.reflect.json'

const DOWN_SHADER = postShader(
  downVertSrc,
  downFragSrc,
  downWgsl,
  downReflect as ShaderReflection,
)
const UP_SHADER = postShader(
  upVertSrc,
  upFragSrc,
  upWgsl,
  upReflect as ShaderReflection,
)

const MIN_LEVELS = 1
const MAX_LEVELS = 6

function clampLevels(v: number): number {
  return Math.min(MAX_LEVELS, Math.max(MIN_LEVELS, Math.round(v)))
}

/** Construction overrides for {@link DualKawaseBlur}. */
export interface DualKawaseBlurOptions {
  enabled?: boolean
  /** Downsample/upsample chain depth, clamped to 1 to 6. Default `4`. */
  levels?: number
  /** Per-pass tap spread in texels. Default `2`. */
  offset?: number
}

/**
 * Downsample/upsample blur (Dual Kawase): far cheaper than a wide Gaussian at
 * the same radius, since each level works on a quarter the pixels of the last.
 * `levels` sets the chain depth and rebuilds `passes` when changed.
 *
 * `levels` steps the radius in roughly 2x jumps, so animating it reads as
 * popping. `offset` is the continuous control, and the one to animate.
 *
 * Every level count draws its passes from one pool built up front, so moving
 * between already-used depths costs no recompile. A depth used for the first
 * time still compiles, and `warm()` only covers the active chain, so construct
 * at the deepest `levels` to be used and warm there: every shallower chain is a
 * subset of it.
 *
 * Blurs gamma-encoded color rather than linear light, a slight darkening at
 * high-contrast edges. Targets are 8-bit, so a smooth result can band without
 * grain layered on top.
 *
 * @example
 *   engine.postProcess.add(new DualKawaseBlur({ levels: 4, offset: 2 }))
 */
export class DualKawaseBlur implements PostEffect {
  enabled: boolean
  /** Per-pass tap spread in texels. Tweakable live. */
  offset: number
  passes: readonly PostPass[]
  #levels: number

  // The full chain, built once and sliced by `levels`. A pass's scale depends
  // only on its index, so every level count draws from the same objects. The
  // pipeline caches compiled GPU resources per PostPass identity, so handing
  // it a fresh object for the same step would recompile and leave the whole
  // chain presenting an unprocessed frame until it finished.
  readonly #down: readonly PostPass[]
  readonly #up: readonly PostPass[]
  readonly #finalUp: PostPass

  constructor(opts: DualKawaseBlurOptions = {}) {
    this.enabled = opts.enabled ?? true
    this.offset = opts.offset ?? 2
    this.#levels = clampLevels(opts.levels ?? 4)
    this.#down = Array.from({ length: MAX_LEVELS }, (_, i) =>
      this.#downPass(2 ** -(i + 1)),
    )
    this.#up = Array.from({ length: MAX_LEVELS }, (_, i) =>
      this.#upPass(2 ** -(i + 1)),
    )
    this.#finalUp = this.#upPass(1)
    this.passes = this.#buildPasses()
  }

  /** Downsample/upsample chain depth. Setting it rebuilds `passes`. */
  get levels(): number {
    return this.#levels
  }
  set levels(v: number) {
    const clamped = clampLevels(v)
    if (clamped === this.#levels) return
    this.#levels = clamped
    this.passes = this.#buildPasses()
  }

  #downPass(scale: number): PostPass {
    return {
      shader: DOWN_SHADER,
      paramsBytes: 16, // vec4 p0
      scale,
      writeParams: (ctx, out) => {
        out[0] = ctx.texelW
        out[1] = ctx.texelH
        out[2] = this.offset
      },
    }
  }

  #upPass(scale: number): PostPass {
    return {
      shader: UP_SHADER,
      paramsBytes: 16, // vec4 p0
      scale,
      writeParams: (ctx, out) => {
        out[0] = ctx.inputTexelW
        out[1] = ctx.inputTexelH
        out[2] = this.offset
      },
    }
  }

  #buildPasses(): PostPass[] {
    const passes: PostPass[] = []
    for (let i = 0; i < this.#levels; i++) passes.push(this.#down[i])
    for (let i = this.#levels - 2; i >= 0; i--) passes.push(this.#up[i])
    passes.push(this.#finalUp)
    return passes
  }
}
