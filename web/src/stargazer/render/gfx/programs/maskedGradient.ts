// Masked-radial-gradient program: `Gfx2D.fillMaskedRadialGradient` (the arcade
// launcher's drifting clouds). Mask silhouette on texture unit 0, gradient LUT
// on unit 1. The mask/LUT lookups live on `GpuGfx` (need `TextureManager`);
// this program owns the shader/VAO/stream plumbing and the buffer write.

import { RingStream } from '../RingStream'
import {
  LOC_MASKGRAD_DST,
  LOC_MASKGRAD_GRAD,
  LOC_MASKGRAD_SRC,
  LOC_MASKGRAD_UNIT,
  MASKED_GRAD_BUFFER_BYTES,
  MASKED_GRAD_INSTANCE_STRIDE,
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
import {
  drawInstancedRun,
  unitQuadLayout,
  warmupBlendPipelines,
} from './programCommon'
import type { ShaderReflection } from '../GfxDevice'
import maskedGradientWgsl from '../shaders/maskedRadialGradient.wgsl?raw'
import maskedGradientVertSrc from '../shaders/maskedRadialGradient.gen.vert.glsl?raw'
import maskedGradientFragSrc from '../shaders/maskedRadialGradient.gen.frag.glsl?raw'
import maskedGradientReflect from '../shaders/maskedRadialGradient.reflect.json'

export class MaskedGradientProgram implements GpuProgram {
  readonly kind = 'maskedGradient' as const

  #shader!: ShaderModule
  #stream!: RingStream
  #pipelines: Map<string, Pipeline> = new Map()
  #vertexLayout: VertexBufferLayout[] = []
  #materialLayout!: BindGroupLayout
  /** (mask → (lut → bind group)); both textures vary per run. */
  #bindGroups = new WeakMap<Texture, WeakMap<Texture, BindGroup>>()

  get stream(): RingStream {
    return this.#stream
  }

  init(device: GfxDevice, _ctx: GpuBatchContext): void {
    this.#shader = device.createShaderModule({
      glsl: { vertex: maskedGradientVertSrc, fragment: maskedGradientFragSrc },
      wgsl: {
        code: maskedGradientWgsl,
        vertexEntry: 'vs_main',
        fragmentEntry: 'fs_main',
      },
      reflection: maskedGradientReflect as ShaderReflection,
      label: 'maskedGradient',
    })
    this.#stream = new RingStream(
      device,
      MASKED_GRAD_BUFFER_BYTES,
      MASKED_GRAD_INSTANCE_STRIDE,
      'maskedGradient',
    )
    this.#materialLayout = device.createBindGroupLayout([
      { binding: 0, type: 'texture-2d' },
      { binding: 1, type: 'texture-2d' },
    ])
    this.#bindGroups = new WeakMap()
    this.#vertexLayout = [
      unitQuadLayout(LOC_MASKGRAD_UNIT),
      {
        arrayStride: MASKED_GRAD_INSTANCE_STRIDE,
        stepMode: 'instance',
        attributes: [
          { location: LOC_MASKGRAD_DST, format: 'float32x4', offset: 0 },
          { location: LOC_MASKGRAD_SRC, format: 'float32x4', offset: 16 },
          { location: LOC_MASKGRAD_GRAD, format: 'float32x4', offset: 32 },
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

  #bindGroupFor(ctx: GpuBatchContext, mask: Texture, lut: Texture): BindGroup {
    let byLut = this.#bindGroups.get(mask)
    if (!byLut) {
      byLut = new WeakMap()
      this.#bindGroups.set(mask, byLut)
    }
    let bg = byLut.get(lut)
    if (!bg) {
      bg = ctx.device.createBindGroup(this.#materialLayout, [
        { binding: 0, resource: { texture: mask } },
        { binding: 1, resource: { texture: lut } },
      ])
      byLut.set(lut, bg)
    }
    return bg
  }

  /**
   * Begin (or continue) the `maskedGradient` batch for `(mask, lut)` and
   * reserve one instance record; returns the word offset, or `-1` on overflow.
   */
  beginInstance(ctx: GpuBatchContext, mask: Texture, lut: Texture): number {
    ctx.beginBatch('maskedGradient', { texture: mask, lut })
    return ctx.reserveInstance(this.#stream)
  }

  commitInstance(slot: number): void {
    this.#stream.commitInstance(slot)
  }

  get floatView(): Float32Array {
    return this.#stream.floatView
  }

  drawRun(ctx: GpuBatchContext, run: DrawRun): void {
    // Mask silhouette on unit 0, gradient LUT on unit 1; both required.
    const material =
      run.texture && run.lut
        ? this.#bindGroupFor(ctx, run.texture, run.lut)
        : null
    drawInstancedRun(
      ctx,
      this.#pipelines,
      ctx.unitQuadBuffer,
      this.#stream,
      MASKED_GRAD_INSTANCE_STRIDE,
      run,
      material,
    )
  }
}
