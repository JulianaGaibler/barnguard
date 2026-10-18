import type { DataTexture } from '../gfx/ShaderQuad'

/**
 * Where a chain's source sits, so a pass can tie its pattern to the owner's own
 * units instead of to the pixels of whatever surface it runs over.
 *
 * `originX`/`originY` are the source's top-left corner in the full render
 * target, in device pixels, counted from the top. `pxPerUnit` is the number of
 * device pixels in one unit of the owner's local space: one CSS pixel for the
 * stage's pipeline, one layer unit for a layer. `unitOriginX`/`unitOriginY` are
 * where that local space's origin falls on the source, in device pixels from
 * its top-left corner. A pattern anchored there stays put under the content
 * when the source's box grows, and a size given in units stays the same size on
 * every screen.
 */
export interface PostPlacement {
  originX: number
  originY: number
  pxPerUnit: number
  unitOriginX: number
  unitOriginY: number
}

/** A source with no offset, one device pixel to the unit. */
export const UNPLACED: Readonly<PostPlacement> = {
  originX: 0,
  originY: 0,
  pxPerUnit: 1,
  unitOriginX: 0,
  unitOriginY: 0,
}

/** The chain's source: its size in device pixels and where it sits. */
export interface PostSourceInfo extends PostPlacement {
  width: number
  height: number
}

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
  /** The texture the whole chain reads, and where it sits. */
  source: PostSourceInfo
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
 * A texture a pass can read besides its input: CPU-owned texels, the chain's
 * source, or the output of an earlier pass of the same run.
 */
export type PostPassTexture = DataTexture | PostStep | 'source'

/** Extra textures one pass can bind, at bindings 1 to 4. */
export const MAX_POST_TEXTURES = 4

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
   * The exact size of this pass's target, in device pixels. Wins over `scale`.
   * Called every frame with the chain's source, so the size can follow a
   * parameter. A result below one pixel is raised to one.
   */
  readonly size?: (source: PostSourceInfo) => { width: number; height: number }
  /**
   * What the pass reads at `u_tex`. `'previous'` (the default) is the output of
   * the pass before it, or the source for the first pass. `'source'` is the
   * texture the chain started from. A pass object is that pass's output, and
   * the pass must run earlier in the same chain.
   */
  readonly input?: 'previous' | 'source' | PostStep
  /**
   * Up to four more textures, bound in order at bindings 1 to 4 and sampled as
   * `u_tex1` to `u_tex4`. A pass listed here must run earlier in the same
   * chain, and its output stays alive until this pass has drawn. A
   * {@link DataTexture} uploads when its version changes.
   */
  readonly textures?: readonly PostPassTexture[]
  /**
   * Write this pass's params into `out` (a `Float32Array` view over the params
   * block) each frame, reading the effect's live fields, so parameters can be
   * tweaked or animated without re-initialization. Omitted when `paramsBytes`
   * is `0`.
   */
  writeParams?(ctx: PostPassContext, out: Float32Array): void
}

/** The pixels a {@link PostDataPass} reads on the CPU. */
export interface PostDataInput {
  /** RGBA, 4 bytes a pixel, row 0 first in the texture's own order. */
  readonly data: Uint8Array
  readonly width: number
  readonly height: number
}

/**
 * A pass that makes a texture instead of drawing one, for work a fragment
 * shader cannot do, such as an algorithm that must visit pixels in order. The
 * texture is `size` pixels of RGBA8 and later passes read it through their
 * `textures`. It keeps its contents between frames.
 *
 * Give it `compute` for devices that have compute shaders and `cpu` for the
 * rest. The chain runs the compute shader where it can and otherwise reads the
 * input back and calls `cpu`.
 *
 * @remarks
 *   The CPU route does not stall. The chain asks the device for the input's
 *   pixels, polls for them each frame, and runs `cpu` once they arrive, so the
 *   result lands a few frames after the input first draws. Until it does, the
 *   texture is all zero. `cpu` runs again only when the input pixels or the
 *   params changed, and a cached layer draws again when the result arrives.
 */
export interface PostDataPass {
  readonly kind: 'data'
  /** The output size, in pixels. Called every frame. */
  readonly size: (source: PostSourceInfo) => { width: number; height: number }
  /** What the pass reads. Same meaning as {@link PostPass.input}. */
  readonly input?: 'previous' | 'source' | PostStep
  /** Std140 byte size of the `Params` block. `0` for none. */
  readonly paramsBytes: number
  /** Write the params each frame, as {@link PostPass.writeParams} does. */
  writeParams?(ctx: PostPassContext, out: Float32Array): void
  /**
   * A WGSL module with a `cs_main` entry point. It binds the input texture at
   * 0, the output as a write-only `rgba8unorm` storage texture at 1 and the
   * params at 6, and runs as `workgroups` workgroups.
   */
  readonly compute?: {
    readonly wgsl: string
    readonly workgroups: (
      ctx: PostPassContext,
    ) => readonly [number, number, number]
  }
  /**
   * Fills `output` (RGBA, `ctx.width` by `ctx.height`, rows in the texture's
   * own order) from `input`. `ctx.uvYDown` says whether row 0 is the top.
   */
  readonly cpu?: (
    input: PostDataInput,
    output: Uint8ClampedArray,
    ctx: PostPassContext,
  ) => void
}

/** One step of an effect: a drawing pass or a data pass. */
export type PostStep = PostPass | PostDataPass

/** Whether `step` is a {@link PostDataPass}. */
export function isDataPass(step: PostStep): step is PostDataPass {
  return (step as PostDataPass).kind === 'data'
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
  readonly passes: readonly PostStep[]
  /**
   * True when the effect removes the fine detail of its input, as a blur does.
   * A layer whose first enabled effect sets it draws into a single-sample
   * surface, because multisampled edges would not survive the effect.
   */
  readonly smoothsInput?: boolean
}
