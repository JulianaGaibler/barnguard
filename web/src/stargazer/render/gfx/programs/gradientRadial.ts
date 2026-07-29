// Radial-gradient program: `Gfx2D.fillCircleRadialGradient`. The gradient LUT
// lookup lives on `GpuGfx` (needs `TextureManager`); this program owns the
// shader/VAO/stream plumbing and the buffer write. The LUT is bound as
// `ctx.curTexture` (this program has no second texture, unlike `maskedGradient`).

import { RingStream } from '../RingStream'
import {
  GRADIENT_BUFFER_BYTES,
  GRADIENT_INSTANCE_STRIDE,
  LOC_GRAD_CENTER,
  LOC_GRAD_RADALPHA,
  LOC_GRAD_UNIT,
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
import gradientRadialWgsl from '../shaders/gradientRadial.wgsl?raw'
import gradientRadialVertSrc from '../shaders/gradientRadial.gen.vert.glsl?raw'
import gradientRadialFragSrc from '../shaders/gradientRadial.gen.frag.glsl?raw'
import gradientRadialReflect from '../shaders/gradientRadial.reflect.json'

export class GradientRadialProgram implements GpuProgram {
  readonly kind = 'gradientRadial' as const

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
      glsl: { vertex: gradientRadialVertSrc, fragment: gradientRadialFragSrc },
      wgsl: {
        code: gradientRadialWgsl,
        vertexEntry: 'vs_main',
        fragmentEntry: 'fs_main',
      },
      reflection: gradientRadialReflect as ShaderReflection,
      label: 'gradientRadial',
    })
    this.#stream = new RingStream(
      device,
      GRADIENT_BUFFER_BYTES,
      GRADIENT_INSTANCE_STRIDE,
      'gradientRadial',
    )
    this.#materialLayout = device.createBindGroupLayout([
      { binding: 0, type: 'texture-2d' },
    ])
    this.#bindGroups = new WeakMap()
    this.#vertexLayout = [
      unitQuadLayout(LOC_GRAD_UNIT),
      {
        arrayStride: GRADIENT_INSTANCE_STRIDE,
        stepMode: 'instance',
        attributes: [
          { location: LOC_GRAD_CENTER, format: 'float32x2', offset: 0 },
          { location: LOC_GRAD_RADALPHA, format: 'float32x2', offset: 8 },
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
   * Begin (or continue) the `gradientRadial` batch for `lut` and reserve one
   * instance record; returns the word offset, or `-1` on overflow.
   */
  beginInstance(ctx: GpuBatchContext, lut: Texture): number {
    ctx.beginBatch('gradientRadial', { texture: lut })
    return ctx.reserveInstance(this.#stream)
  }

  commitInstance(slot: number): void {
    this.#stream.commitInstance(slot)
  }

  get floatView(): Float32Array {
    return this.#stream.floatView
  }

  drawRun(ctx: GpuBatchContext, run: DrawRun): void {
    const material = run.texture ? this.#bindGroupFor(ctx, run.texture) : null
    drawInstancedRun(
      ctx,
      this.#pipelines,
      ctx.unitQuadBuffer,
      this.#stream,
      GRADIENT_INSTANCE_STRIDE,
      run,
      material,
    )
  }
}
