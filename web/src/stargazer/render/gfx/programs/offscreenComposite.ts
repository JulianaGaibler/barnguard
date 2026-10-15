// Offscreen composite program: draws a rectangle of an offscreen surface into
// the enclosing target, with a group opacity and an optional second surface as
// a track matte. Registered as an ordinary `GpuProgram`, so it shares the
// target format, the stencil clip test and the re-warm on retarget.

import { RingStream } from '../RingStream'
import {
  COMPOSITE_BUFFER_BYTES,
  COMPOSITE_VERTEX_STRIDE,
  LOC_COMPOSITE_POS,
  LOC_COMPOSITE_UV,
} from '../batchLayout'
import type { DrawRun, GpuBatchContext } from '../GpuBatchContext'
import type { GpuProgram } from '../GpuProgram'
import type {
  BindGroup,
  BindGroupLayout,
  GfxDevice,
  Pipeline,
  ShaderModule,
  ShaderReflection,
  Texture,
  VertexBufferLayout,
} from '../GfxDevice'
import { CLIP_DEPTH_SHIFT } from '../stencilRecipe'
import { UboRing, warmupBlendPipelines } from './programCommon'
import offscreenCompositeWgsl from '../shaders/offscreenComposite.wgsl?raw'
import offscreenCompositeVertSrc from '../shaders/offscreenComposite.gen.vert.glsl?raw'
import offscreenCompositeFragSrc from '../shaders/offscreenComposite.gen.frag.glsl?raw'
import offscreenCompositeReflect from '../shaders/offscreenComposite.reflect.json'

/** How a matte surface scales the composited content. */
export type MatteMode =
  'none' | 'alpha' | 'inverted-alpha' | 'luma' | 'inverted-luma'

const MATTE_CODE: Record<MatteMode, number> = {
  none: 0,
  alpha: 1,
  'inverted-alpha': 2,
  luma: 3,
  'inverted-luma': 4,
}

/**
 * One composite: the surface texture, the optional matte texture, the opacity
 * and the matte mode. Each composite is its own draw run.
 */
export interface CompositeDraw {
  tex: Texture
  matte: Texture | null
  matteMode: MatteMode
  opacity: number
}

/** Params block: opacity, matte mode, padding to 16 bytes. */
const PARAMS_BYTES = 16

export class OffscreenCompositeProgram implements GpuProgram {
  readonly kind = 'composite' as const

  #shader!: ShaderModule
  #stream!: RingStream
  #pipelines: Map<string, Pipeline> = new Map()
  #vertexLayout: VertexBufferLayout[] = []
  #materialLayout!: BindGroupLayout
  #paramsRing!: UboRing
  #device!: GfxDevice
  #paramsGen = 0
  #bindGroups = new WeakMap<Texture, WeakMap<Texture, BindGroup>>()
  readonly #staging = new Float32Array(PARAMS_BYTES / 4)

  get stream(): RingStream {
    return this.#stream
  }

  init(device: GfxDevice, _ctx: GpuBatchContext): void {
    this.#device = device
    this.#shader = device.createShaderModule({
      glsl: {
        vertex: offscreenCompositeVertSrc,
        fragment: offscreenCompositeFragSrc,
      },
      wgsl: {
        code: offscreenCompositeWgsl,
        vertexEntry: 'vs_main',
        fragmentEntry: 'fs_main',
      },
      reflection: offscreenCompositeReflect as ShaderReflection,
      label: 'offscreenComposite',
    })
    this.#stream = new RingStream(
      device,
      COMPOSITE_BUFFER_BYTES,
      COMPOSITE_VERTEX_STRIDE,
      'composite',
    )
    this.#vertexLayout = [
      {
        arrayStride: COMPOSITE_VERTEX_STRIDE,
        stepMode: 'vertex',
        attributes: [
          { location: LOC_COMPOSITE_POS, format: 'float32x2', offset: 0 },
          { location: LOC_COMPOSITE_UV, format: 'float32x2', offset: 8 },
        ],
      },
    ]
    this.#materialLayout = device.createBindGroupLayout([
      { binding: 2, type: 'uniform-buffer', dynamicOffset: true },
      { binding: 1, type: 'texture-2d' },
      { binding: 3, type: 'texture-2d' },
    ])
    this.#paramsRing = new UboRing(
      device,
      PARAMS_BYTES,
      256,
      'compositeParams',
      true,
      true,
    )
    this.#bindGroups = new WeakMap()
  }

  async warmup(device: GfxDevice, ctx: GpuBatchContext): Promise<void> {
    this.#pipelines = await warmupBlendPipelines(device, ctx, {
      shader: this.#shader,
      vertexLayout: this.#vertexLayout,
      bindGroupLayouts: [ctx.frameBindGroupLayout, this.#materialLayout],
      blends: [
        'source-over',
        'lighter',
        'screen',
        'multiply',
        'destination-out',
        'destination-in',
        'xor',
      ],
    })
  }

  uboSlices(): number {
    return this.#paramsRing.pushes
  }

  resetFrame(): void {
    this.#paramsRing.reset(this.#device)
  }

  /**
   * Record a quad of `draw`'s surface. `quad` holds the four corners as device
   * pixels in the enclosing target and `uv` the matching texture coordinates,
   * both as `[x0, y0, x1, y1, x2, y2, x3, y3]` going around the quad.
   */
  record(
    ctx: GpuBatchContext,
    draw: CompositeDraw,
    quad: ArrayLike<number>,
    uv: ArrayLike<number>,
  ): void {
    ctx.beginBatch('composite', { composite: draw })
    const words = 6 * 4
    const off = ctx.reserveVerts(this.#stream, words, 6)
    if (off < 0) return
    const f = this.#stream.floatView
    // Two triangles: 0 1 2, 0 2 3.
    const order = [0, 1, 2, 0, 2, 3]
    for (let i = 0; i < 6; i++) {
      const c = order[i]
      f[off + i * 4] = quad[c * 2]
      f[off + i * 4 + 1] = quad[c * 2 + 1]
      f[off + i * 4 + 2] = uv[c * 2]
      f[off + i * 4 + 3] = uv[c * 2 + 1]
    }
    this.#stream.commit(ctx.curSlot, words, 6)
  }

  prepareRun(_ctx: GpuBatchContext, run: DrawRun): void {
    const draw = run.composite
    if (!draw || (run.endWord - run.startWord) / 4 === 0) return
    const s = this.#staging
    s[0] = draw.opacity
    s[1] = MATTE_CODE[draw.matteMode]
    s[2] = 0
    s[3] = 0
    run.paramsOffset = this.#paramsRing.push(this.#device, s)
  }

  flushRings(device: GfxDevice): void {
    this.#paramsRing.flush(device)
  }

  drawRun(ctx: GpuBatchContext, run: DrawRun): void {
    const draw = run.composite
    if (!draw) return
    const first = run.startWord / 4
    const count = (run.endWord - run.startWord) / 4
    if (count === 0) return
    const offset = run.paramsOffset
    if (offset === undefined || offset < 0) return
    const clipDepth = run.stencilDepth ?? 0
    const pipeline = this.#pipelines.get(
      clipDepth > 0 ? `${run.blend}|clipTest` : run.blend,
    )
    if (!pipeline) return
    ctx.device.draw({
      pipeline,
      stencilReference:
        clipDepth > 0 ? clipDepth << CLIP_DEPTH_SHIFT : undefined,
      vertexBuffers: [{ buffer: this.#stream.buffers[ctx.curSlot], offset: 0 }],
      bindGroups: [
        ctx.frameBindGroupEntry(ctx.clipOffsetForRun(run)),
        {
          group: 1,
          bindGroup: this.#bindGroupFor(
            ctx,
            draw.tex,
            draw.matte ?? ctx.placeholderTexture,
          ),
          dynamicOffsets: [offset],
        },
      ],
      vertexCount: count,
      first,
    })
    ctx.stats.drawCalls++
  }

  #bindGroupFor(ctx: GpuBatchContext, tex: Texture, matte: Texture): BindGroup {
    if (this.#paramsGen !== this.#paramsRing.generation) {
      this.#paramsGen = this.#paramsRing.generation
      this.#bindGroups = new WeakMap()
    }
    let byMatte = this.#bindGroups.get(tex)
    if (!byMatte) {
      byMatte = new WeakMap()
      this.#bindGroups.set(tex, byMatte)
    }
    let bg = byMatte.get(matte)
    if (!bg) {
      bg = ctx.device.createBindGroup(this.#materialLayout, [
        {
          binding: 2,
          resource: {
            uniformBuffer: this.#paramsRing.buffer,
            size: PARAMS_BYTES,
          },
        },
        { binding: 1, resource: { texture: tex } },
        { binding: 3, resource: { texture: matte } },
      ])
      byMatte.set(matte, bg)
    }
    return bg
  }
}
