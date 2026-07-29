// Shared helpers for the draw programs under the new pipeline/bind-group model:
// building shader reflection from name→binding maps, a dynamic-offset uniform
// ring for per-run/per-object data, and the instanced draw-run replay.

import type {
  BindGroup,
  BindGroupLayout,
  CullMode,
  DepthState,
  DrawBindGroup,
  FrontFace,
  GfxBlendMode,
  GfxDevice,
  Pipeline,
  PrimitiveTopology,
  ShaderModule,
  ShaderReflection,
  UBuffer,
  VertexBufferLayout,
} from '../GfxDevice'
import type { RingStream } from '../RingStream'
import type { DrawRun, GpuBatchContext } from '../GpuBatchContext'

/**
 * Build {@link ShaderReflection} from name→number maps, mirroring the old
 * `ProgramOpts` shape: attribute name → location, uniform-block name → binding,
 * sampler name → binding. WebGL2 uses these to wire the linked program; WebGPU
 * ignores them.
 */
export function reflection(spec: {
  attribs: Record<string, number>
  uniformBlocks?: Record<string, number>
  samplers?: Record<string, number>
}): ShaderReflection {
  return {
    attributes: Object.entries(spec.attribs).map(([glslName, location]) => ({
      location,
      glslName,
    })),
    uniformBlocks: Object.entries(spec.uniformBlocks ?? {}).map(
      ([glslName, binding]) => ({ binding, glslName }),
    ),
    samplers: Object.entries(spec.samplers ?? {}).map(
      ([glslName, binding]) => ({
        binding,
        glslName,
      }),
    ),
  }
}

/**
 * A dynamic-offset uniform ring: many small per-draw uniform slices packed into
 * one buffer, each aligned to the device's UBO offset alignment. `reset` once
 * per frame; `push` writes a slice and returns its byte offset for a draw's
 * `dynamicOffsets`. Returns `-1` on overflow (the caller drops that draw's
 * per-run data, matching the vertex ring's overflow behavior).
 */
export class UboRing {
  readonly buffer: UBuffer
  readonly #sliceBytes: number
  readonly #capacityBytes: number
  #cursor = 0
  #warned = false
  readonly #label: string

  constructor(
    device: GfxDevice,
    dataBytes: number,
    slots: number,
    label = 'ubo-ring',
  ) {
    const align = device.limits.minUniformBufferOffsetAlignment
    this.#sliceBytes = Math.ceil(dataBytes / align) * align
    this.#capacityBytes = this.#sliceBytes * slots
    this.#label = label
    this.buffer = device.createUniformBuffer(this.#capacityBytes)
  }

  /** Fixed per-slice byte length — the `size` for a dynamic bind-group entry. */
  get sliceBytes(): number {
    return this.#sliceBytes
  }

  reset(): void {
    this.#cursor = 0
    this.#warned = false
  }

  /**
   * Write `data` into the next slice; returns its byte offset or `-1` on
   * overflow.
   */
  push(device: GfxDevice, data: ArrayBufferView): number {
    if (this.#cursor + this.#sliceBytes > this.#capacityBytes) {
      if (!this.#warned) {
        this.#warned = true
        console.warn(
          `GpuGfx: '${this.#label}' uniform ring overflow, dropping per-draw uniforms for the remainder of this frame`,
        )
      }
      return -1
    }
    const offset = this.#cursor
    device.updateUniformBuffer(this.buffer, data, offset)
    this.#cursor += this.#sliceBytes
    return offset
  }
}

/** The blend variants a 2D program needs (source-over fills, lighter additive). */
export const BLEND_VARIANTS: GfxBlendMode[] = ['source-over', 'lighter']

/**
 * Create a program's pipelines, one per blend variant, keyed by blend for
 * per-run selection. Color format + samples come from the batch context's
 * current target. All variants share vertex layout, bind-group layouts, and
 * depth/cull/winding/primitive.
 */
export async function warmupBlendPipelines(
  device: GfxDevice,
  ctx: GpuBatchContext,
  opts: {
    shader: ShaderModule
    vertexLayout: VertexBufferLayout[]
    bindGroupLayouts: BindGroupLayout[]
    blends?: GfxBlendMode[]
    depth?: DepthState | null
    cull?: CullMode
    frontFace?: FrontFace
    primitive?: PrimitiveTopology
  },
): Promise<Map<string, Pipeline>> {
  const map = new Map<string, Pipeline>()
  for (const blend of opts.blends ?? BLEND_VARIANTS) {
    const pipeline = await device.createPipeline({
      shader: opts.shader,
      vertexLayout: opts.vertexLayout,
      bindGroupLayouts: opts.bindGroupLayouts,
      color: { format: ctx.targetColor.format, blend },
      depth: opts.depth ?? null,
      cull: opts.cull ?? 'none',
      frontFace: opts.frontFace ?? 'ccw',
      primitive: opts.primitive ?? 'triangle-list',
      samples: ctx.targetColor.samples,
    })
    map.set(blend, pipeline)
  }
  return map
}

/** One vertex-buffer layout slot for a unit-quad attribute at `location`. */
export function unitQuadLayout(location: number): VertexBufferLayout {
  return {
    arrayStride: 8,
    stepMode: 'vertex',
    attributes: [{ location, format: 'float32x2', offset: 0 }],
  }
}

/**
 * Replay one recorded run of an instanced-quad program: pick the pipeline for
 * the run's blend, bind the unit quad + the instance sub-range (base offset in
 * the instance buffer), attach the frame + per-run bind groups, and draw.
 */
export function drawInstancedRun(
  ctx: GpuBatchContext,
  pipelines: Map<string, Pipeline>,
  unitQuad: import('../GfxDevice').VBuffer,
  stream: RingStream,
  strideBytes: number,
  run: DrawRun,
  materialBindGroup: BindGroup | null,
): void {
  const words = strideBytes / 4
  const instCount = (run.endWord - run.startWord) / words
  if (instCount === 0) return
  const pipeline = pipelines.get(run.blend)
  if (!pipeline) return
  const bindGroups: DrawBindGroup[] = [ctx.frameBindGroupEntry()]
  if (materialBindGroup)
    bindGroups.push({ group: 1, bindGroup: materialBindGroup })
  ctx.device.draw({
    pipeline,
    vertexBuffers: [
      { buffer: unitQuad, offset: 0 },
      { buffer: stream.buffers[ctx.curSlot], offset: run.startWord * 4 },
    ],
    bindGroups,
    vertexCount: 6,
    instanceCount: instCount,
  })
  ctx.stats.drawCalls++
}
