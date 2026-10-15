/**
 * Per-frame context handed to a {@link PostPass}'s {@link PostPass.writeParams}
 * callback. `width`/`height` are the device-pixel dimensions of the target this
 * pass draws INTO (the full frame unless {@link PostPass.scale} shrinks it).
 * `inputWidth`/`inputHeight` are the dimensions of the texture this pass reads
 * FROM, the previous pass's output (or the frame itself for the first pass of
 * the chain). The two agree for a full-resolution pass, and diverge for a
 * downsample or upsample step. `texelW`/`texelH` and
 * `inputTexelW`/`inputTexelH` are the matching reciprocals, ready for
 * neighbor-sampling offsets. `time` accumulates seconds across the pipeline's
 * life for animated effects. `dt` is the current frame's delta.
 */
export interface PostPassContext {
  width: number
  height: number
  /** `1 / width`. */
  texelW: number
  /** `1 / height`. */
  texelH: number
  /** Width of the texture this pass samples from. */
  inputWidth: number
  /** Height of the texture this pass samples from. */
  inputHeight: number
  /** `1 / inputWidth`. */
  inputTexelW: number
  /** `1 / inputHeight`. */
  inputTexelH: number
  /**
   * True when `a_uv.y` grows downward on screen (WebGPU), false when it grows
   * upward (WebGL2). The built-in effects are radially symmetric and never need
   * this; a pass with a directional or anchored parameter (an angle, an
   * off-center position) reads it to normalize that parameter to one convention
   * on both backends.
   */
  uvYDown: boolean
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
 */
export interface PostPass {
  /** WGSL-first shader sources (WGSL + generated GLSL + reflection). */
  readonly shader: PostShaderSource
  /** Std140 byte size of the pass's `Params` block. `0` for a pass with none. */
  readonly paramsBytes: number
  /**
   * Fraction of the frame's device-pixel size this pass renders at, applied
   * independently to width and height and floored: `max(1, floor(frameSize *
   * scale))`. Default `1` (full resolution). Always relative to the frame size
   * the pipeline was given this run, never to the previous pass's output, so a
   * chain of passes can each request an absolute fraction (a downsample chain's
   * `2 ** -(i + 1)` at every level) without compounding rounding error.
   */
  readonly scale?: number
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
 * frame in each pass's {@link PostPass.writeParams}, so they can be tweaked or
 * animated live. Effects run in insertion order, each reading the previous
 * one's output.
 *
 * The engine ships {@link ChromaticAberration}, {@link Vignette}, and
 * {@link VignetteBlur}. Implement this interface for a custom effect.
 */
export interface PostEffect {
  /** When false the pipeline skips the effect (and its passes) entirely. */
  enabled: boolean
  /** The passes to run, in order. Usually fixed for an effect's lifetime. */
  readonly passes: readonly PostPass[]
  /**
   * True when the effect removes the fine detail of its input, as a blur does.
   * A layer whose first enabled effect sets it draws into a single-sample
   * surface, because multisampled edges would not survive the effect.
   */
  readonly smoothsInput?: boolean
}
