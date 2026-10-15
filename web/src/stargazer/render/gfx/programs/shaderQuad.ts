// Shader-quad program: `Gfx2D.drawShaderQuad`, a rectangle drawn with the
// caller's own shader. One draw run per call, since every call can carry its
// own params and textures. The per-quad GPU state (shader module, pipelines,
// bind group, uploaded textures) is built lazily on first draw and keyed on the
// `ShaderQuad` object, so it dies with it.

import { RingStream } from '../RingStream'
import {
  LOC_QUAD_AXISY_ALPHA,
  LOC_QUAD_ORIGIN_AXISX,
  LOC_QUAD_UNIT,
  SHADER_QUAD_BUFFER_BYTES,
  SHADER_QUAD_INSTANCE_STRIDE,
  SHADER_QUAD_PARAMS_UBO_BINDING,
} from '../batchLayout'
import type { DrawRun, GpuBatchContext } from '../GpuBatchContext'
import type { GpuProgram } from '../GpuProgram'
import type {
  BindGroup,
  BindGroupEntry,
  BindGroupLayout,
  BindGroupLayoutEntry,
  GfxDevice,
  Pipeline,
  ShaderModule,
  Texture,
  VertexBufferLayout,
} from '../GfxDevice'
import type { GfxBlend } from '../Gfx2D'
import {
  MAX_QUAD_PARAMS_BYTES,
  type DataTexture,
  type ShaderQuad,
} from '../ShaderQuad'
import { CLIP_DEPTH_SHIFT } from '../stencilRecipe'
import { UboRing, unitQuadLayout, buildBlendPipelines } from './programCommon'

/** Params slices the ring starts with. It grows when a frame needs more. */
const PARAMS_SLOTS = 512

/**
 * What a recorded draw carries beyond its instance: the quad, and the byte
 * offset of the params slice written when it was recorded.
 */
export interface ShaderQuadDraw {
  quad: ShaderQuad
  paramsOffset: number
}

interface QuadGpu {
  shader: ShaderModule
  layout: BindGroupLayout
  /** `${target}|${blend}` to pipeline. */
  pipelines: Map<string, Pipeline>
  pending: Set<string>
  bindGroup: BindGroup | null
  /** Params ring generation the bind group was built against. */
  ringGeneration: number
}

interface UploadedTexture {
  texture: Texture
  version: number
}

export class ShaderQuadProgram implements GpuProgram {
  readonly kind = 'shaderQuad' as const

  #device!: GfxDevice
  #stream!: RingStream
  #paramsRing!: UboRing
  #vertexLayout: VertexBufferLayout[] = []
  #gpu = new WeakMap<ShaderQuad, QuadGpu>()
  #uploads = new WeakMap<DataTexture, UploadedTexture>()
  readonly #paramsStaging = new Uint8Array(MAX_QUAD_PARAMS_BYTES)

  get stream(): RingStream {
    return this.#stream
  }

  init(device: GfxDevice, _ctx: GpuBatchContext): void {
    this.#device = device
    this.#stream = new RingStream(
      device,
      SHADER_QUAD_BUFFER_BYTES,
      SHADER_QUAD_INSTANCE_STRIDE,
      'shaderQuad',
    )
    this.#paramsRing = new UboRing(
      device,
      MAX_QUAD_PARAMS_BYTES,
      PARAMS_SLOTS,
      'shaderQuadParams',
      true,
      true,
    )
    this.#gpu = new WeakMap()
    this.#uploads = new WeakMap()
    this.#vertexLayout = [
      unitQuadLayout(LOC_QUAD_UNIT),
      {
        arrayStride: SHADER_QUAD_INSTANCE_STRIDE,
        stepMode: 'instance',
        attributes: [
          { location: LOC_QUAD_ORIGIN_AXISX, format: 'float32x4', offset: 0 },
          { location: LOC_QUAD_AXISY_ALPHA, format: 'float32x4', offset: 16 },
        ],
      },
    ]
  }

  // Pipelines belong to each quad's own shader, so there is nothing to warm
  // before the first draw.
  async warmup(_device: GfxDevice, _ctx: GpuBatchContext): Promise<void> {}

  uboSlices(): number {
    return this.#paramsRing.pushes
  }

  resetFrame(): void {
    this.#paramsRing.reset(this.#device)
  }

  flushRings(device: GfxDevice): void {
    this.#paramsRing.flush(device)
  }

  /**
   * Record one draw. Returns without drawing while the quad's pipeline for the
   * current blend and target is still compiling.
   */
  record(
    ctx: GpuBatchContext,
    quad: ShaderQuad,
    x: number,
    y: number,
    w: number,
    h: number,
  ): void {
    const gpu = this.#gpuFor(ctx.device, quad)
    const blend = ctx.stateStack.getBlend()
    if (!this.#pipelineFor(ctx, quad, gpu, blend)) return
    this.#bindGroupFor(ctx, quad, gpu)

    let paramsOffset = 0
    if (quad.paramsBytes > 0) {
      const staging = this.#paramsStaging
      staging.set(
        new Uint8Array(
          quad.params.buffer,
          quad.params.byteOffset,
          quad.paramsBytes,
        ),
      )
      paramsOffset = this.#paramsRing.push(ctx.device, staging)
    }

    ctx.beginBatch('shaderQuad', { shaderQuad: { quad, paramsOffset } })
    const off = ctx.reserveInstance(this.#stream)
    if (off < 0) return
    const slot = ctx.curSlot
    ctx.txStack.read(ctx.txOut)
    const t = ctx.txOut
    const f = this.#stream.floatView
    f[off + 0] = t.a * x + t.c * y + t.e
    f[off + 1] = t.b * x + t.d * y + t.f
    f[off + 2] = t.a * w
    f[off + 3] = t.b * w
    f[off + 4] = t.c * h
    f[off + 5] = t.d * h
    f[off + 6] = ctx.stateStack.getAlpha()
    f[off + 7] = 0
    this.#stream.commitInstance(slot)
  }

  drawRun(ctx: GpuBatchContext, run: DrawRun): void {
    const draw = run.shaderQuad
    if (!draw) return
    const gpu = this.#gpu.get(draw.quad)
    if (!gpu?.bindGroup) return
    const clipDepth = run.stencilDepth ?? 0
    const key = pipelineKey(ctx, run.blend)
    const pipeline = gpu.pipelines.get(clipDepth > 0 ? `${key}|clipTest` : key)
    if (!pipeline) return
    const bindGroup = this.#bindGroupFor(ctx, draw.quad, gpu)
    const instCount =
      (run.endWord - run.startWord) / (SHADER_QUAD_INSTANCE_STRIDE / 4)
    if (instCount === 0) return
    ctx.device.draw({
      pipeline,
      stencilReference:
        clipDepth > 0 ? clipDepth << CLIP_DEPTH_SHIFT : undefined,
      vertexBuffers: [
        { buffer: ctx.unitQuadBuffer, offset: 0 },
        {
          buffer: this.#stream.buffers[ctx.curSlot],
          offset: run.startWord * 4,
        },
      ],
      bindGroups: [
        ctx.frameBindGroupEntry(ctx.clipOffsetForRun(run)),
        {
          group: 1,
          bindGroup,
          dynamicOffsets: draw.quad.paramsBytes > 0 ? [draw.paramsOffset] : [],
        },
      ],
      vertexCount: 6,
      instanceCount: instCount,
    })
    ctx.stats.drawCalls++
  }

  #gpuFor(device: GfxDevice, quad: ShaderQuad): QuadGpu {
    let gpu = this.#gpu.get(quad)
    if (gpu) return gpu
    const entries: BindGroupLayoutEntry[] = quad.textures.map((_, i) => ({
      binding: i,
      type: 'texture-2d',
    }))
    if (quad.paramsBytes > 0) {
      entries.push({
        binding: SHADER_QUAD_PARAMS_UBO_BINDING,
        type: 'uniform-buffer',
        dynamicOffset: true,
      })
    }
    gpu = {
      shader: device.createShaderModule({
        glsl: quad.shader.glsl,
        wgsl: quad.shader.wgsl,
        reflection: quad.shader.reflection,
        label: quad.label,
      }),
      layout: device.createBindGroupLayout(entries),
      pipelines: new Map(),
      pending: new Set(),
      bindGroup: null,
      ringGeneration: -1,
    }
    this.#gpu.set(quad, gpu)
    return gpu
  }

  /** The compiled pipeline, or `null` after starting its compile. */
  #pipelineFor(
    ctx: GpuBatchContext,
    _quad: ShaderQuad,
    gpu: QuadGpu,
    blend: GfxBlend,
  ): Pipeline | null {
    const key = pipelineKey(ctx, blend)
    const hit = gpu.pipelines.get(key)
    if (hit) return hit
    if (gpu.pending.has(key)) return null
    gpu.pending.add(key)
    const mode = blend === 'lighter' ? 'lighter' : 'source-over'
    const map = new Map<string, Pipeline>()
    void buildBlendPipelines(
      ctx.device,
      ctx,
      {
        shader: gpu.shader,
        vertexLayout: this.#vertexLayout,
        bindGroupLayouts: [ctx.frameBindGroupLayout, gpu.layout],
        blends: [mode],
      },
      ctx.passSamples,
      map,
    ).then(
      () => {
        const pipeline = map.get(mode)
        if (pipeline) gpu.pipelines.set(key, pipeline)
        const clipped = map.get(`${mode}|clipTest`)
        if (clipped) gpu.pipelines.set(`${key}|clipTest`, clipped)
        gpu.pending.delete(key)
      },
      (err) => {
        // Left pending so a broken shader reports once instead of every frame.
        console.error('ShaderQuad: pipeline creation failed', err)
      },
    )
    return null
  }

  /**
   * Upload any dirty data texture, then build the bind group the first time its
   * textures all exist.
   */
  #bindGroupFor(
    ctx: GpuBatchContext,
    quad: ShaderQuad,
    gpu: QuadGpu,
  ): BindGroup {
    const device = ctx.device
    let rebuilt = false
    const bound: Texture[] = []
    for (const data of quad.textures) {
      let up = this.#uploads.get(data)
      if (!up) {
        up = {
          texture: device.createTexture2D({
            width: data.width,
            height: data.height,
            filter: data.filter,
            wrap: 'clamp',
          }),
          version: 0,
        }
        this.#uploads.set(data, up)
        rebuilt = true
      }
      if (up.version !== data.version) {
        device.updateTexture2D(
          up.texture,
          new ImageData(
            data.data as Uint8ClampedArray<ArrayBuffer>,
            data.width,
            data.height,
          ),
          { objectSpaceUV: true },
        )
        up.version = data.version
      }
      bound.push(up.texture)
    }
    if (
      gpu.bindGroup &&
      !rebuilt &&
      gpu.ringGeneration === this.#paramsRing.generation
    ) {
      return gpu.bindGroup
    }
    gpu.ringGeneration = this.#paramsRing.generation
    const entries: BindGroupEntry[] = bound.map((texture, i) => ({
      binding: i,
      resource: { texture },
    }))
    if (quad.paramsBytes > 0) {
      entries.push({
        binding: SHADER_QUAD_PARAMS_UBO_BINDING,
        resource: {
          uniformBuffer: this.#paramsRing.buffer,
          size: quad.paramsBytes,
        },
      })
    }
    gpu.bindGroup = device.createBindGroup(gpu.layout, entries)
    return gpu.bindGroup
  }
}

/** The pipeline's key: the target's format and the pass's sample count. */
function pipelineKey(ctx: GpuBatchContext, blend: GfxBlend): string {
  const t = ctx.targetFormat
  return `${t.format}|${ctx.passSamples}|${t.depthStencil}|${blend}`
}
