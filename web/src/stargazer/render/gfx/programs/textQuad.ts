// Text-quad program: `Gfx2D.fillText`. Draws a cached label texture as an
// affine quad, so rotation is free (no re-rasterization, just a different
// per-instance matrix). Reuses `texturedQuad`'s fragment shader; only the
// vertex stage (affine placement) differs. Label lookup lives on `GpuGfx`
// (needs `TextureManager`); this program owns the shader/VAO/stream plumbing
// and the buffer write.

import { RingStream } from '../RingStream'
import {
  LOC_TEXT_MCOL0,
  LOC_TEXT_MCOL1,
  LOC_TEXT_MTRANSLATE,
  LOC_TEXT_SRC,
  LOC_TEXT_TINT,
  LOC_TEXT_UNIT,
  TEXT_QUAD_BUFFER_BYTES,
  TEXT_QUAD_INSTANCE_STRIDE,
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
import textQuadWgsl from '../shaders/textQuad.wgsl?raw'
import textQuadVertSrc from '../shaders/textQuad.gen.vert.glsl?raw'
import textQuadFragSrc from '../shaders/textQuad.gen.frag.glsl?raw'
import textQuadReflect from '../shaders/textQuad.reflect.json'

export class TextQuadProgram implements GpuProgram {
  readonly kind = 'textQuad' as const

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
      glsl: { vertex: textQuadVertSrc, fragment: textQuadFragSrc },
      wgsl: {
        code: textQuadWgsl,
        vertexEntry: 'vs_main',
        fragmentEntry: 'fs_main',
      },
      reflection: textQuadReflect as ShaderReflection,
      label: 'textQuad',
    })
    this.#stream = new RingStream(
      device,
      TEXT_QUAD_BUFFER_BYTES,
      TEXT_QUAD_INSTANCE_STRIDE,
      'textQuad',
    )
    this.#materialLayout = device.createBindGroupLayout([
      { binding: 0, type: 'texture-2d' },
    ])
    this.#bindGroups = new WeakMap()
    this.#vertexLayout = [
      unitQuadLayout(LOC_TEXT_UNIT),
      {
        arrayStride: TEXT_QUAD_INSTANCE_STRIDE,
        stepMode: 'instance',
        attributes: [
          { location: LOC_TEXT_MCOL0, format: 'float32x2', offset: 0 },
          { location: LOC_TEXT_MCOL1, format: 'float32x2', offset: 8 },
          { location: LOC_TEXT_MTRANSLATE, format: 'float32x2', offset: 16 },
          { location: LOC_TEXT_SRC, format: 'float32x4', offset: 24 },
          { location: LOC_TEXT_TINT, format: 'unorm8x4', offset: 40 },
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
   * Begin (or continue) the `textQuad` batch for `tex` and reserve one instance
   * record; returns the word offset, or `-1` on overflow.
   */
  beginInstance(ctx: GpuBatchContext, tex: Texture): number {
    ctx.beginBatch('textQuad', { texture: tex })
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
      TEXT_QUAD_INSTANCE_STRIDE,
      run,
      material,
    )
  }
}
