// Shared helpers for the draw programs under the new pipeline/bind-group model:
// building shader reflection from name->binding maps, a dynamic-offset uniform
// ring for per-run/per-object data, and the instanced draw-run replay.

import type {
  BindGroup,
  BindGroupLayout,
  CullMode,
  DepthState,
  StencilState,
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
import { CLIP_DEPTH_SHIFT, STENCIL_ROWS } from '../stencilRecipe'

/**
 * Build {@link ShaderReflection} from name->number maps, mirroring the old
 * `ProgramOpts` shape: attribute name -> location, uniform-block name ->
 * binding, sampler name -> binding. WebGL2 uses these to wire the linked
 * program, and WebGPU ignores them.
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
 * per frame. `push` writes a slice and returns its byte offset for a draw's
 * `dynamicOffsets`.
 *
 * @remarks
 *   Engine developers: a fixed ring returns `-1` from `push` when full and the
 *   caller drops that draw's per-run data. A growable ring (the 2D programs)
 *   never fails. When its buffer is full it switches to a new buffer of twice
 *   the capacity and restarts the cursor. Draws already recorded keep naming
 *   the old buffer, which is deleted at the start of the next frame, after the
 *   frame that used it has been submitted. `generation` increments on every
 *   switch, so a bind group that captured `buffer` must be rebuilt when it
 *   changes (see {@link UboRing.generation}).
 *
 *   The capacity follows demand. It doubles on overflow and halves after
 *   {@link UBO_RING_DECAY_FRAMES} consecutive frames that used under a quarter
 *   of it, so one spike does not hold its peak forever.
 */
export class UboRing {
  #buffer: UBuffer
  readonly #sliceBytes: number
  readonly #minSlots: number
  #slots: number
  #cursor = 0
  #highWater = 0
  #quietFrames = 0
  #generation = 0
  /** Replaced buffers that recorded draws of the open frame may still name. */
  readonly #retired: UBuffer[] = []
  #pushes = 0
  #warned = false
  readonly #growable: boolean
  readonly #staged: boolean
  /** CPU copy of a staged ring's slices, uploaded once by `flush`. */
  #staging = new Uint8Array(0)
  readonly #label: string

  constructor(
    device: GfxDevice,
    dataBytes: number,
    slots: number,
    label = 'ubo-ring',
    growable = false,
    staged = false,
  ) {
    this.#label = label
    this.#staged = staged
    this.#growable = growable || staged
    const align = device.limits.minUniformBufferOffsetAlignment
    this.#sliceBytes = Math.ceil(dataBytes / align) * align
    this.#minSlots = slots
    this.#slots = slots
    this.#buffer = device.createUniformBuffer(this.#sliceBytes * slots)
  }

  /** The current GPU buffer. Changes when the ring grows or shrinks. */
  get buffer(): UBuffer {
    return this.#buffer
  }

  /**
   * Increments each time `buffer` is replaced. A cache of bind groups that
   * reference `buffer` is stale once this differs from the value it saw.
   */
  get generation(): number {
    return this.#generation
  }

  /** Fixed per-slice byte length, the `size` for a dynamic bind-group entry. */
  get sliceBytes(): number {
    return this.#sliceBytes
  }

  /** Slices pushed since the last `reset`. */
  get pushes(): number {
    return this.#pushes
  }

  /** Current capacity in slices. */
  get capacity(): number {
    return this.#slots
  }

  /** Start a new frame. Applies the shrink policy. */
  reset(device?: GfxDevice): void {
    this.#warned = false
    if (device && this.#retired.length > 0) {
      for (const b of this.#retired) device.deleteUniformBuffer(b)
      this.#retired.length = 0
    }
    if (!this.#growable || !device) {
      this.#cursor = 0
      return
    }
    const used = this.#highWater
    this.#cursor = 0
    this.#highWater = 0
    this.#pushes = 0
    if (
      this.#slots > this.#minSlots &&
      used * 4 < this.#slots * this.#sliceBytes
    ) {
      if (++this.#quietFrames >= UBO_RING_DECAY_FRAMES) {
        this.#quietFrames = 0
        this.#replace(device, Math.max(this.#minSlots, this.#slots >> 1))
      }
    } else {
      this.#quietFrames = 0
    }
  }

  /** Write `data` into the next slice and return its byte offset. */
  push(device: GfxDevice, data: ArrayBufferView): number {
    if (this.#staged) return this.#stage(data)
    if (this.#cursor + this.#sliceBytes > this.#slots * this.#sliceBytes) {
      if (!this.#growable) {
        if (!this.#warned) {
          this.#warned = true
          console.warn(
            `GpuGfx: '${this.#label}' uniform ring overflow, dropping per-draw uniforms for the remainder of this frame`,
          )
        }
        return -1
      }
      this.#replace(device, this.#slots * 2)
    }
    const offset = this.#cursor
    device.updateUniformBuffer(this.#buffer, data, offset)
    this.#cursor += this.#sliceBytes
    this.#pushes++
    if (this.#cursor > this.#highWater) this.#highWater = this.#cursor
    return offset
  }

  /** Copy `data` into the next slice of the CPU staging area. */
  #stage(data: ArrayBufferView): number {
    const need = this.#cursor + this.#sliceBytes
    if (need > this.#staging.byteLength) {
      const grown = new Uint8Array(
        Math.max(need, this.#staging.byteLength * 2, this.#sliceBytes * 64),
      )
      grown.set(this.#staging)
      this.#staging = grown
    }
    this.#staging.set(
      new Uint8Array(data.buffer, data.byteOffset, data.byteLength),
      this.#cursor,
    )
    const offset = this.#cursor
    this.#cursor = need
    this.#pushes++
    if (this.#cursor > this.#highWater) this.#highWater = this.#cursor
    return offset
  }

  /**
   * Upload every staged slice in one write. A staged ring must be flushed after
   * its last `push` of the frame and before the first draw that reads a slice,
   * and the buffer grows here when the slices outgrew it.
   */
  flush(device: GfxDevice): void {
    if (!this.#staged || this.#cursor === 0) return
    if (this.#cursor > this.#slots * this.#sliceBytes) {
      let slots = this.#slots
      while (this.#cursor > slots * this.#sliceBytes) slots *= 2
      this.#replace(device, slots)
    }
    device.updateUniformBuffer(
      this.#buffer,
      this.#staging.subarray(0, this.#cursor),
      0,
    )
  }

  /** Release the GPU buffer. */
  dispose(device: GfxDevice): void {
    for (const b of this.#retired) device.deleteUniformBuffer(b)
    this.#retired.length = 0
    device.deleteUniformBuffer(this.#buffer)
  }

  #replace(device: GfxDevice, slots: number): void {
    this.#retired.push(this.#buffer)
    this.#slots = slots
    this.#buffer = device.createUniformBuffer(this.#sliceBytes * slots)
    // A staged ring keeps its slices, which `flush` writes into the new buffer.
    if (!this.#staged) this.#cursor = 0
    this.#generation++
  }
}

/** Frames a ring must stay under a quarter full before it halves. */
export const UBO_RING_DECAY_FRAMES = 60

/** The blend variants a 2D program needs (source-over fills, lighter additive). */
export const BLEND_VARIANTS: GfxBlendMode[] = ['source-over', 'lighter']

/** What {@link warmupBlendPipelines} builds a program's pipelines from. */
export type BlendPipelineOptions = Parameters<typeof warmupBlendPipelines>[2]

/**
 * A program's pipelines, with a single-sample set beside the target's own. A
 * lookup returns the set that matches the pass being drawn into, so a program
 * picks its pipeline by key alone.
 */
export class SampledPipelines extends Map<string, Pipeline> {
  /** The same keys, built for a single-sample pass. */
  readonly single = new Map<string, Pipeline>()
  readonly #ctx: GpuBatchContext

  constructor(ctx: GpuBatchContext) {
    super()
    this.#ctx = ctx
  }

  override get(key: string): Pipeline | undefined {
    const ctx = this.#ctx
    if (ctx.passSamples === 1 && ctx.targetFormat.samples > 1) {
      return this.single.get(key)
    }
    return super.get(key)
  }
}

/**
 * Create a program's pipelines, one per blend variant, keyed by blend for
 * per-run selection. The color format comes from the batch context's current
 * target. All variants share vertex layout, bind-group layouts, and
 * depth/cull/winding/primitive.
 *
 * With `samples` left out the pipelines match the target's sample count, and
 * the set is recorded on `ctx`, so {@link GpuBatchContext.warmSingleSample} can
 * add the single-sample set later.
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
    /**
     * Extra variants beyond the plain one, each keyed `${blend}|${suffix}` so a
     * program can select one per draw run.
     */
    variants?: Array<{
      suffix: string
      stencil?: StencilState | null
      colorWrite?: boolean
    }>
  },
  samples?: number,
): Promise<SampledPipelines> {
  const map = new SampledPipelines(ctx)
  if (samples === undefined) ctx.pipelineSets.push({ options: opts, map })
  await buildBlendPipelines(
    device,
    ctx,
    opts,
    samples ?? ctx.targetFormat.samples,
    map,
  )
  return map
}

/** Fill `into` with a program's pipelines, built for `samples`. */
export async function buildBlendPipelines(
  device: GfxDevice,
  ctx: GpuBatchContext,
  opts: BlendPipelineOptions,
  samples: number,
  into: Map<string, Pipeline>,
): Promise<void> {
  const target = ctx.targetFormat
  const variants = [
    { suffix: '', stencil: null as StencilState | null, colorWrite: true },
    ...(opts.variants ?? []),
    // The state of an ordinary draw inside a clip path. Only where the target
    // has stencil bits.
    ...(ctx.targetHasStencil
      ? [
          {
            suffix: 'clipTest',
            stencil: STENCIL_ROWS.clipTest.state as StencilState | null,
            colorWrite: true,
          },
        ]
      : []),
  ]
  for (const blend of opts.blends ?? BLEND_VARIANTS) {
    for (const v of variants) {
      const pipeline = await device.createPipeline({
        shader: opts.shader,
        vertexLayout: opts.vertexLayout,
        bindGroupLayouts: opts.bindGroupLayouts,
        color: {
          format: target.format,
          blend,
          write: v.colorWrite ?? true,
        },
        depth: opts.depth ?? null,
        stencil: v.stencil ?? null,
        // The 2D path is painter-ordered and tests nothing, but it shares a
        // pass with whatever else draws into the target, so it declares the
        // attachment it renders into and lets the backend fill in the aspects
        // it does not use.
        depthStencil: target.depthStencil,
        cull: opts.cull ?? 'none',
        frontFace: opts.frontFace ?? 'ccw',
        primitive: opts.primitive ?? 'triangle-list',
        samples,
      })
      into.set(v.suffix ? `${blend}|${v.suffix}` : blend, pipeline)
    }
  }
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
  /** Pipeline-map suffix, for a program with per-run variants. */
  variant?: string,
  /** Stencil reference for the draw, when the variant tests stencil. */
  stencilReference?: number,
): void {
  const words = strideBytes / 4
  const instCount = (run.endWord - run.startWord) / words
  if (instCount === 0) return
  const clipDepth = run.stencilDepth ?? 0
  const clipped = !variant && clipDepth > 0
  const pipeline = pipelines.get(
    variant
      ? `${run.blend}|${variant}`
      : clipped
        ? `${run.blend}|clipTest`
        : run.blend,
  )
  if (!pipeline) return
  const bindGroups: DrawBindGroup[] = [
    ctx.frameBindGroupEntry(ctx.clipOffsetForRun(run)),
  ]
  if (materialBindGroup)
    bindGroups.push({ group: 1, bindGroup: materialBindGroup })
  ctx.device.draw({
    pipeline,
    vertexBuffers: [
      { buffer: unitQuad, offset: 0 },
      {
        buffer: run.instances?.buffer ?? stream.buffers[ctx.curSlot],
        offset: run.startWord * 4,
      },
    ],
    bindGroups,
    vertexCount: 6,
    instanceCount: instCount,
    stencilReference: clipped
      ? clipDepth << CLIP_DEPTH_SHIFT
      : stencilReference,
  })
  ctx.stats.drawCalls++
}
