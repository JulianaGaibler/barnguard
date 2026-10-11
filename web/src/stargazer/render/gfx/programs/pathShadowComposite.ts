// Outset path-shadow composite program: an instanced affine quad sampling a
// cached blurred-coverage mask (`PathShadowCache`), tinted and knocked out of
// the shape's own silhouette. Registered as an ordinary `GpuProgram` so it
// shares the screen target's format, the analytic clip, and `GpuGfx`'s
// re-warm on retarget, same reasoning as every other 2D program.

import { RingStream } from '../RingStream'
import {
  LOC_PATHSHADOW_DITHER,
  LOC_PATHSHADOW_MCOL0,
  LOC_PATHSHADOW_MCOL1,
  LOC_PATHSHADOW_MTRANSLATE,
  LOC_PATHSHADOW_SRC,
  LOC_PATHSHADOW_TINT,
  LOC_PATHSHADOW_UNIT,
  PATHSHADOW_BUFFER_BYTES,
  PATHSHADOW_INSTANCE_STRIDE,
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
import pathShadowCompositeWgsl from '../shaders/pathShadowComposite.wgsl?raw'
import pathShadowCompositeVertSrc from '../shaders/pathShadowComposite.gen.vert.glsl?raw'
import pathShadowCompositeFragSrc from '../shaders/pathShadowComposite.gen.frag.glsl?raw'
import pathShadowCompositeReflect from '../shaders/pathShadowComposite.reflect.json'

export class PathShadowCompositeProgram implements GpuProgram {
  readonly kind = 'pathShadowComposite' as const

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
      glsl: {
        vertex: pathShadowCompositeVertSrc,
        fragment: pathShadowCompositeFragSrc,
      },
      wgsl: {
        code: pathShadowCompositeWgsl,
        vertexEntry: 'vs_main',
        fragmentEntry: 'fs_main',
      },
      reflection: pathShadowCompositeReflect as ShaderReflection,
      label: 'pathShadowComposite',
    })
    this.#stream = new RingStream(
      device,
      PATHSHADOW_BUFFER_BYTES,
      PATHSHADOW_INSTANCE_STRIDE,
      'pathShadowComposite',
    )
    this.#materialLayout = device.createBindGroupLayout([
      { binding: 0, type: 'texture-2d' },
    ])
    this.#bindGroups = new WeakMap()
    this.#vertexLayout = [
      unitQuadLayout(LOC_PATHSHADOW_UNIT),
      {
        arrayStride: PATHSHADOW_INSTANCE_STRIDE,
        stepMode: 'instance',
        attributes: [
          { location: LOC_PATHSHADOW_MCOL0, format: 'float32x2', offset: 0 },
          { location: LOC_PATHSHADOW_MCOL1, format: 'float32x2', offset: 8 },
          {
            location: LOC_PATHSHADOW_MTRANSLATE,
            format: 'float32x2',
            offset: 16,
          },
          { location: LOC_PATHSHADOW_SRC, format: 'float32x4', offset: 24 },
          { location: LOC_PATHSHADOW_TINT, format: 'unorm8x4', offset: 40 },
          { location: LOC_PATHSHADOW_DITHER, format: 'float32', offset: 44 },
        ],
      },
    ]
  }

  async warmup(device: GfxDevice, ctx: GpuBatchContext): Promise<void> {
    this.#pipelines = await warmupBlendPipelines(device, ctx, {
      shader: this.#shader,
      vertexLayout: this.#vertexLayout,
      bindGroupLayouts: [ctx.frameBindGroupLayout, this.#materialLayout],
      // The knockout and the tint's own alpha already resolve translucency
      // correctly under plain over-compositing. A shadow is never drawn
      // additively.
      blends: ['source-over'],
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
   * Begin (or continue) the batch for `mask` and reserve one instance record.
   * Returns the word offset, or `-1` on overflow.
   */
  beginInstance(ctx: GpuBatchContext, mask: Texture): number {
    ctx.beginBatch('pathShadowComposite', { texture: mask })
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
      PATHSHADOW_INSTANCE_STRIDE,
      run,
      material,
    )
  }
}
