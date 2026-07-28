// Textured-quad program: axis-aligned image blits (`Gfx2D.drawImage`). The
// texture-atlas lookup and the rotation tripwire live on `GpuGfx` (they need
// `TextureManager` and the diagnostic counters); this program owns the
// shader/VAO/stream plumbing and the buffer write.

import { RingStream } from '../RingStream'
import {
  LOC_TEXTURED_DST,
  LOC_TEXTURED_SRC,
  LOC_TEXTURED_TINT,
  LOC_TEXTURED_UNIT,
  TEXTURED_QUAD_BUFFER_BYTES,
  TEXTURED_QUAD_INSTANCE_STRIDE,
} from '../batchLayout'
import type { DrawRun, GpuBatchContext } from '../GpuBatchContext'
import type { GpuProgram } from '../GpuProgram'
import type {
  BindGroup,
  BindGroupLayout,
  GfxDevice,
  Pipeline,
  ShaderModule,
  Texture,
  VertexBufferLayout,
} from '../GfxDevice'
import { drawInstancedRun, unitQuadLayout, warmupBlendPipelines } from './programCommon'
import type { ShaderReflection } from '../GfxDevice'
import texturedQuadWgsl from '../shaders/texturedQuad.wgsl?raw'
import texturedQuadVertSrc from '../shaders/texturedQuad.gen.vert.glsl?raw'
import texturedQuadFragSrc from '../shaders/texturedQuad.gen.frag.glsl?raw'
import texturedQuadReflect from '../shaders/texturedQuad.reflect.json'

export class TexturedQuadProgram implements GpuProgram {
  readonly kind = 'texturedQuad' as const

  #shader!: ShaderModule
  #stream!: RingStream
  #pipelines: Map<string, Pipeline> = new Map()
  #vertexLayout: VertexBufferLayout[] = []
  #materialLayout!: BindGroupLayout
  #bindGroups = new WeakMap<Texture, BindGroup>()

  get stream(): RingStream {
    return this.#stream
  }

  init(device: GfxDevice, _ctx: GpuBatchContext): void {
    this.#shader = device.createShaderModule({
      glsl: { vertex: texturedQuadVertSrc, fragment: texturedQuadFragSrc },
      wgsl: {
        code: texturedQuadWgsl,
        vertexEntry: 'vs_main',
        fragmentEntry: 'fs_main',
      },
      reflection: texturedQuadReflect as ShaderReflection,
      label: 'texturedQuad',
    })
    this.#stream = new RingStream(
      device,
      TEXTURED_QUAD_BUFFER_BYTES,
      TEXTURED_QUAD_INSTANCE_STRIDE,
      'texturedQuad',
    )
    this.#materialLayout = device.createBindGroupLayout([
      { binding: 0, type: 'texture-2d' },
    ])
    this.#bindGroups = new WeakMap()
    this.#vertexLayout = [
      unitQuadLayout(LOC_TEXTURED_UNIT),
      {
        arrayStride: TEXTURED_QUAD_INSTANCE_STRIDE,
        stepMode: 'instance',
        attributes: [
          { location: LOC_TEXTURED_DST, format: 'float32x4', offset: 0 },
          { location: LOC_TEXTURED_SRC, format: 'float32x4', offset: 16 },
          { location: LOC_TEXTURED_TINT, format: 'unorm8x4', offset: 32 },
        ],
      },
    ]
  }

  async warmup(device: GfxDevice, ctx: GpuBatchContext): Promise<void> {
    this.#pipelines = await warmupBlendPipelines(device, ctx, {
      shader: this.#shader,
      vertexLayout: this.#vertexLayout,
      bindGroupLayouts: [ctx.frameBindGroupLayout, this.#materialLayout],
    })
  }

  #bindGroupFor(ctx: GpuBatchContext, tex: Texture): BindGroup {
    let bg = this.#bindGroups.get(tex)
    if (!bg) {
      bg = ctx.device.createBindGroup(this.#materialLayout, [
        { binding: 0, resource: { texture: tex } },
      ])
      this.#bindGroups.set(tex, bg)
    }
    return bg
  }

  /**
   * Begin (or continue) the `texturedQuad` batch for `tex` and reserve one
   * instance record; returns the word offset to write into `floatView`/
   * `uintView`, or `-1` on overflow.
   */
  beginInstance(ctx: GpuBatchContext, tex: Texture): number {
    ctx.beginBatch('texturedQuad', { texture: tex })
    return ctx.reserveInstance(this.#stream)
  }

  commitInstance(slot: number): void {
    this.#stream.commitInstance(slot)
  }

  get floatView(): Float32Array {
    return this.#stream.floatView
  }

  get uintView(): Uint32Array {
    return this.#stream.uintView
  }

  drawRun(ctx: GpuBatchContext, run: DrawRun): void {
    const material = run.texture ? this.#bindGroupFor(ctx, run.texture) : null
    drawInstancedRun(
      ctx,
      this.#pipelines,
      ctx.unitQuadBuffer,
      this.#stream,
      TEXTURED_QUAD_INSTANCE_STRIDE,
      run,
      material,
    )
  }
}
