/**
 * Per-frame context handed to a {@link PostPass}'s {@link PostPass.bind}
 * callback. Sizes are the device-pixel dimensions of the target the pass draws
 * into (the full frame for the built-in effects). `texelW`/`texelH` are their
 * reciprocals, ready for neighbor-sampling offsets. `time` accumulates seconds
 * across the pipeline's life for animated effects. `dt` is the current frame's
 * delta.
 *
 * @category Render
 */
export interface PostPassContext {
  width: number
  height: number
  /** `1 / width`. */
  texelW: number
  /** `1 / height`. */
  texelH: number
  /** Seconds accumulated since the pipeline started. */
  time: number
  /** Current frame delta, in seconds. */
  dt: number
}

import type { ShaderReflection } from '../gfx/GfxDevice'

/**
 * A post-pass's compiled shader sources: WGSL (the source of truth, for
 * WebGPU), the GLSL ES 300 generated from it (for WebGL2), and the reflection
 * sidecar mapping bindings to generated names, all produced by
 * `crates/shader-gen` and imported `?raw` / as JSON. Each effect authors one
 * WGSL module containing the shared fullscreen vertex (`vs_main`) and its own
 * fragment (`fs_main`), sampling `u_tex` at unit 0 and reading its `Params`
 * block at `POST_PARAMS_UBO_BINDING`.
 */
export interface PostShaderSource {
  readonly glsl: { vertex: string; fragment: string }
  readonly wgsl: { code: string; vertexEntry: string; fragmentEntry: string }
  readonly reflection: ShaderReflection
}

/** Build a {@link PostShaderSource} from a shader module's generated artifacts. */
export function postShader(
  vertex: string,
  fragment: string,
  wgsl: string,
  reflection: ShaderReflection,
): PostShaderSource {
  return {
    glsl: { vertex, fragment },
    wgsl: { code: wgsl, vertexEntry: 'vs_main', fragmentEntry: 'fs_main' },
    reflection,
  }
}

/**
 * One fullscreen post-processing pass: a shader plus its per-pass uniform
 * params. The pipeline provides the fullscreen triangle, binds the input
 * texture to `u_tex` (sampler unit 0), and binds the params block the pass
 * writes each frame.
 *
 * @category Render
 */
export interface PostPass {
  /** WGSL-first shader sources (WGSL + generated GLSL + reflection). */
  readonly shader: PostShaderSource
  /** Std140 byte size of the pass's `Params` block. `0` for a pass with none. */
  readonly paramsBytes: number
  /**
   * Write this pass's params into `out` (a `Float32Array` view over the params
   * block) each frame, reading the effect's live fields, so parameters can be
   * tweaked or animated without re-initialization. Omitted when `paramsBytes`
   * is `0`.
   */
  writeParams?(ctx: PostPassContext, out: Float32Array): void
}

/**
 * A pluggable screen-space effect: an ordered list of fullscreen
 * {@link PostPass}es and an enable flag. Add instances to a
 * {@link PostProcessPipeline} (`stage.postProcess` / `engine.postProcess`).
 * Parameters are plain public fields on the concrete effect, read fresh each
 * frame in each pass's {@link PostPass.bind}, so they can be tweaked or animated
 * live. Effects run in insertion order, each reading the previous one's
 * output.
 *
 * The engine ships {@link ChromaticAberration}, {@link Vignette}, and
 * {@link VignetteBlur}. Implement this interface for a custom effect.
 *
 * @category Render
 */
export interface PostEffect {
  /** When false the pipeline skips the effect (and its passes) entirely. */
  enabled: boolean
  /** The passes to run, in order. Usually fixed for an effect's lifetime. */
  readonly passes: readonly PostPass[]
}
