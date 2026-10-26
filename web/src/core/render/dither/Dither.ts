import {
  DataTexture,
  postShader,
  type PostDataPass,
  type PostEffect,
  type PostPass,
  type PostStep,
  type PostPassContext,
  type ShaderReflection,
} from 'stargazer'
import cellsWgsl from './ditherCells.gen.wgsl?raw'
import cellsVertex from './ditherCells.gen.vert.glsl?raw'
import cellsFragment from './ditherCells.gen.frag.glsl?raw'
import cellsReflection from './ditherCells.reflect.json'
import dotsWgsl from './ditherDots.gen.wgsl?raw'
import dotsVertex from './ditherDots.gen.vert.glsl?raw'
import dotsFragment from './ditherDots.gen.frag.glsl?raw'
import dotsReflection from './ditherDots.reflect.json'
import diffusionWgsl from './ditherDiffusion.gen.wgsl?raw'
import { blueNoiseTexture } from './blueNoise'
import { DIFFUSION_ROW_LIMIT, diffuseCells } from './errorDiffusion'
import {
  DEFAULT_DITHER,
  DITHER_PARAMS_BYTES,
  gridFor,
  packDitherParams,
  type DitherSettings,
} from './params'

/** Stands in for the error-diffusion mask when the pattern does not use one. */
const NO_MASK = new DataTexture(1, 1)

/**
 * The brand's bitmapped look: the surface is cut into a grid of cells, each
 * cell takes the average color of what it covers, and a dot is drawn in it by a
 * threshold pattern. Put it in a layer's `effects` to dither that layer.
 *
 * The cell size is in the layer's own units, so a layer with a fixed frame
 * dithers the same way on every screen. A static layer should use `cache:
 * 'raster'`, which runs the effect once.
 *
 * @example
 *   new Layer({
 *     id: 'art',
 *     space: { frame: { x: 0, y: 0, width: 1920, height: 1080 } },
 *     cache: 'raster',
 *     effects: [new Dither(ditherPreset('stageMountain'))],
 *   })
 */
export class Dither implements PostEffect {
  enabled = true
  /** Every setting. Change them live. */
  readonly settings: DitherSettings
  readonly #plain: readonly PostStep[]
  readonly #diffused: readonly PostStep[]

  constructor(settings: Partial<DitherSettings> = {}) {
    this.settings = { ...DEFAULT_DITHER, ...settings }
    const write = (ctx: PostPassContext, out: Float32Array) =>
      packDitherParams(
        this.settings,
        ctx.source,
        gridFor(this.settings, ctx.source),
        ctx.uvYDown,
        ctx.time,
        out,
      )
    const cells: PostPass = {
      shader: postShader(
        cellsVertex,
        cellsFragment,
        cellsWgsl,
        cellsReflection as ShaderReflection,
      ),
      paramsBytes: DITHER_PARAMS_BYTES,
      size: (source) => {
        const grid = gridFor(this.settings, source)
        return { width: grid.columns, height: grid.rows }
      },
      writeParams: write,
    }
    const dotsShader = postShader(
      dotsVertex,
      dotsFragment,
      dotsWgsl,
      dotsReflection as ShaderReflection,
    )
    const dots = (mask: DataTexture | PostDataPass): PostPass => ({
      shader: dotsShader,
      paramsBytes: DITHER_PARAMS_BYTES,
      input: cells,
      textures: [blueNoiseTexture(), mask],
      writeParams: write,
    })
    let warned = false
    const diffusion: PostDataPass = {
      kind: 'data',
      input: cells,
      paramsBytes: DITHER_PARAMS_BYTES,
      size: (source) => {
        const grid = gridFor(this.settings, source)
        return { width: grid.columns, height: grid.rows }
      },
      writeParams: (ctx, out) => {
        write(ctx, out)
        if (!warned && ctx.height > DIFFUSION_ROW_LIMIT) {
          warned = true
          console.warn(
            `Dither: diffusion covers at most ${DIFFUSION_ROW_LIMIT} rows of cells, and this grid has ${ctx.height}. Use a larger cell size.`,
          )
        }
      },
      compute: { wgsl: diffusionWgsl, workgroups: () => [1, 1, 1] },
      cpu: (input, output, ctx) =>
        diffuseCells(input, output, ctx, this.settings),
    }
    this.#plain = [cells, dots(NO_MASK)]
    this.#diffused = [cells, diffusion, dots(diffusion)]
  }

  /** The passes for the pattern now set. A pattern change swaps the list. */
  get passes(): readonly PostStep[] {
    return this.settings.pattern === 'diffusion' ? this.#diffused : this.#plain
  }
}
