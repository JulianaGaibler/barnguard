/**
 * WebGPU implementation of `GfxDevice`. Owns a `GPUDevice` and its canvas
 * context and implements the pipeline/bind-group/render-pass model directly: a
 * frame is a `GPUCommandEncoder`, a pass is a `GPURenderPassEncoder` with its
 * attachments and load/store ops, a pipeline is an immutable
 * `GPURenderPipeline` memoized by descriptor, and a bind group resolves to a
 * `GPUBindGroup`.
 *
 * Acquisition is async (`navigator.gpu.requestAdapter` / `requestDevice`) while
 * the interface is mostly synchronous, so construction goes through the static
 * `WebGPUDevice.create` factory and the constructor is private: by the time the
 * device exists the `GPUDevice`, context, and preferred format are all in
 * hand.
 *
 * Sampler binding convention: the WGSL declares each texture's companion
 * sampler at `textureBinding + 16` (regular textures) and each shadow map's
 * comparison sampler likewise (shadow texture at 8/9, sampler at 24/25). The
 * caller's `BindGroupLayoutEntry[]` / `BindGroupEntry[]` list only the
 * texture/uniform bindings, so this backend derives and adds the matching
 * sampler entries at `+16` for every texture and shadow entry.
 */

import type {
  BindGroup,
  BindGroupEntry,
  BindGroupLayout,
  BindGroupLayoutEntry,
  BlitOpts,
  ColorFormat,
  CompareFn,
  ComputeDispatch,
  ComputePipeline,
  ComputePipelineDesc,
  DepthTarget,
  DeviceLimits,
  DeviceStats,
  DrawCall,
  GfxDevice,
  IBuffer,
  IndexType,
  NdcConventions,
  Pipeline,
  PipelineDesc,
  RenderPassDesc,
  ScissorRect,
  RenderTarget,
  RenderTargetOpts,
  ShaderModule,
  ShaderModuleDesc,
  ShadowArray,
  ShadowCube,
  TargetPixelFormat,
  Texture,
  Texture2DOpts,
  TexturePixelFormat,
  TextureUploadOpts,
  UBuffer,
  DataTable,
  VBuffer,
  VertexBufferLayout,
} from '../GfxDevice'
import { PassBindingState } from './bindingState'
import {
  colorFormatToGPU,
  colorTargetToGPU,
  compareFnToGPU,
  depthStencilFormatToGPU,
  depthStencilToGPU,
  cullModeToGPU,
  frontFaceToGPU,
  indexTypeToGPU,
  roundUp4,
  sampleCountToGPU,
  targetPixelFormatToGPU,
  texturePixelBytes,
  texturePixelFormatToGPU,
  topologyToGPU,
  vertexFormatToGPU,
} from './conv'
import {
  depthStencilFormatFor,
  depthStencilFormatOf,
  hasDepthAspect,
  hasStencilAspect,
} from '../depthStencil'
import { BlitPass, mipLevels } from './blitPass'
import { pipelineKey } from '../pipelineKey'
import {
  getSourceWidth,
  getSourceHeight,
  resolveUploadFlipY,
  packUploadRGBA,
} from '../imageSource'

// --- concrete backing structs (kept private, exposed as branded handles) ----

interface WebGPUShader extends ShaderModule {
  module: GPUShaderModule
  vertexEntry?: string
  fragmentEntry?: string
  computeEntry?: string
}

interface WebGPUPipeline extends Pipeline {
  gpu: GPURenderPipeline
  vertexLayout: VertexBufferLayout[]
  /** The descriptor's stencil reference, the default for a draw. */
  stencilRef: number
}

interface WebGPUComputePipeline extends ComputePipeline {
  gpu: GPUComputePipeline
}

interface WebGPUBindGroupLayout extends BindGroupLayout {
  gpu: GPUBindGroupLayout
  entries: BindGroupLayoutEntry[]
}

interface WebGPUBindGroup extends BindGroup {
  gpu: GPUBindGroup
}

interface WebGPUBuffer extends VBuffer {
  gpu: GPUBuffer
  byteSize: number
}

interface WebGPUUniformBuffer extends UBuffer {
  gpu: GPUBuffer
  byteSize: number
}

interface WebGPUDataTable extends DataTable {
  gpu: GPUBuffer
}

interface WebGPUIndexBuffer extends IBuffer {
  gpu: GPUBuffer
  byteSize: number
  indexType: IndexType
}

interface WebGPUTexture extends Texture {
  gpu: GPUTexture
  width: number
  height: number
  filter: 'nearest' | 'linear'
  wrap: 'clamp' | 'repeat'
  srgb: boolean
  mipmap: boolean
  anisotropy: number
  pixelFormat: TexturePixelFormat
  /**
   * Set when the handle wraps a render target's color texture (via
   * `colorTexture`), so `deleteTexture` on it doesn't destroy a texture the
   * render target still owns.
   */
  owned: boolean
}

interface WebGPUShadowArray extends ShadowArray {
  gpu: GPUTexture
  compare: CompareFn
}

interface WebGPUShadowCube extends ShadowCube {
  gpu: GPUTexture
  compare: CompareFn
}

type WebGPURenderTarget = RenderTarget & {
  /**
   * The canvas target. Its `color` is the swapchain texture of the current
   * frame, so it is read through a getter and never owned.
   */
  isCanvas?: true
  /** Sampleable single-sample color texture (present unless MSAA is on). */
  color?: GPUTexture
  /** Multisample color texture, allocated only when `samples > 1`. */
  colorMs?: GPUTexture
  /** The actual GPU format `color`/`colorMs` was allocated with, for resize. */
  colorFormat: GPUTextureFormat
  depthTex?: GPUTexture
  /**
   * The format `depthTex` was allocated with. A resize reallocates from this
   * rather than re-deriving it, so a target keeps whichever aspects it was
   * built with.
   */
  depthFormat?: GPUTextureFormat
  stencilTex?: GPUTexture
  /** Depth allocated as a sampleable single-sample texture (G-buffer). */
  depthSampled?: boolean
  width: number
  height: number
  samples: number
}

// --- device -----------------------------------------------------------------

/** Submits whose timestamps can wait to be read at once. */
const QUERY_SLOTS = 4

export class WebGPUDevice implements GfxDevice {
  readonly #device: GPUDevice
  readonly #context: GPUCanvasContext
  /** The format the canvas context was configured with. */
  readonly #canvasFormat: GPUTextureFormat
  #canvasTarget: WebGPURenderTarget | null = null

  #lost = false
  #destroying = false
  /** Latched once `copyExternalImageToTexture` throws (a browser gap). */
  #copyExternalBroken = false
  readonly #lostCbs = new Set<() => void>()
  readonly #restoredCbs = new Set<() => void>()

  /** The frame's command encoder, open between `beginFrame` and `endFrame`. */
  #encoder: GPUCommandEncoder | null = null
  /**
   * Resources whose destruction is held until the next submit. A submit is
   * validated against every resource its commands reference, so destroying one
   * that an already-recorded command names fails the whole submit ("Buffer ...
   * has been destroyed" out of `Queue::submit`). Commands accumulate on
   * `#encoder` across passes and only reach the queue at `endFrame`, so
   * anything deleted mid-frame has to outlive that window. Destroying right
   * after the submit is safe: the driver keeps the memory alive until the GPU
   * is finished with it.
   */
  readonly #pendingDestroy: { destroy(): void }[] = []
  /** The current render pass, open between `beginRenderPass`/`endRenderPass`. */
  #pass: GPURenderPassEncoder | null = null
  /** The current compute pass, open between `beginComputePass`/`endComputePass`. */
  #computePass: GPUComputePassEncoder | null = null
  /** Last pipeline set on the open pass, for the `pipelineSwitches` stat. */
  #lastPipeline: GPURenderPipeline | null = null
  /** What the open render pass already has bound, see {@link PassBindingState}. */
  readonly #bindings = new PassBindingState<GPUBuffer, GPUBindGroup>()
  /** Pass state a draw may change: reset to the WebGPU defaults per pass. */
  #stencilRef = 0
  #scissorSet = false
  #passW = 0
  #passH = 0
  #scissorKey = ''

  // Cached samplers reused across bind groups. Regular textures share one
  // filtering sampler per (filter, wrap). Shadows share a comparison sampler
  // per CompareFn. Sampled depth (G-buffer) uses a non-filtering sampler.
  readonly #filterSamplers = new Map<string, GPUSampler>()
  readonly #comparisonSamplers = new Map<CompareFn, GPUSampler>()
  #nonFilteringSampler: GPUSampler | null = null

  // Fullscreen-triangle blit (present) + mipmap generation. Built lazily and
  // needs only the device + swapchain format, so it lives in its own helper.
  readonly #blit: BlitPass

  readonly deviceStats: DeviceStats = {
    pipelineSwitches: 0,
    textureBinds: 0,
    bindGroupSwitches: 0,
    passes: 0,
    submits: 0,
    bindGroupsCreated: 0,
    uniformWrites: 0,
  }

  readonly limits: DeviceLimits

  readonly backend = 'webgpu' as const

  readonly supportsCompute = true

  /**
   * WebGPU conventions: `[0,1]` clip depth and top-down sampled render-target
   * textures. Front-face winding stays `'ccw'` (same as WebGL): with this
   * engine's projection (no 2D Y-flip, only a clip-Z change) the geometry
   * reaches the same framebuffer-space winding on both backends, so declaring
   * `'cw'` culls the outward faces instead of the inward ones.
   */
  readonly ndc: NdcConventions = {
    clipDepth: 'zero-to-one',
    frontFace: 'ccw',
    textureTopDown: true,
  }

  /** Pipeline memoization: descriptor key -> pipeline. */
  readonly #pipelineCache = new Map<string, WebGPUPipeline>()

  /**
   * Acquire an adapter + device, configure the canvas for WebGPU, and build a
   * device. Async because adapter/device acquisition is. Throws a clear error
   * if WebGPU is unavailable or the adapter/device request fails.
   */
  static async create(canvas: HTMLCanvasElement): Promise<WebGPUDevice> {
    if (!navigator.gpu) {
      throw new Error('WebGPUDevice: navigator.gpu is unavailable (no WebGPU)')
    }
    const adapter = await navigator.gpu.requestAdapter()
    if (!adapter) {
      throw new Error('WebGPUDevice: requestAdapter returned null')
    }
    // Timestamps time the GPU work of each frame, for the benchmark and the
    // quality panel. Some browsers keep the feature behind a setting.
    const timestamps = adapter.features.has('timestamp-query')
    const device = await adapter.requestDevice(
      timestamps ? { requiredFeatures: ['timestamp-query'] } : undefined,
    )
    if (!device) {
      throw new Error('WebGPUDevice: requestDevice returned null')
    }
    const context = canvas.getContext('webgpu')
    if (!context) {
      throw new Error('WebGPUDevice: failed to acquire a webgpu context')
    }
    const format = navigator.gpu.getPreferredCanvasFormat()
    context.configure({
      device,
      format,
      alphaMode: 'premultiplied',
      usage: GPUTextureUsage.RENDER_ATTACHMENT | GPUTextureUsage.COPY_DST,
    })
    return new WebGPUDevice(device, context, format)
  }

  private constructor(
    device: GPUDevice,
    context: GPUCanvasContext,
    preferredFormat: GPUTextureFormat,
  ) {
    this.#device = device
    this.#context = context
    this.#canvasFormat = preferredFormat
    this.#blit = new BlitPass(device, preferredFormat)
    this.limits = {
      minUniformBufferOffsetAlignment:
        device.limits.minUniformBufferOffsetAlignment,
      maxDataTableVec4: Math.floor(
        Math.min(
          device.limits.maxStorageBufferBindingSize,
          device.limits.maxBufferSize,
        ) / 16,
      ),
    }
    // A device loss fires once and never restores. Ignore the loss that a
    // deliberate `destroy` triggers so teardown doesn't spuriously fire the
    // context-loss callbacks.
    void device.lost.then((info) => {
      if (this.#destroying) return
      this.#lost = true
      // A WebGPU loss is terminal and there is no fallback, so the only trace
      // it leaves is whatever is said here. Silence made a lost device
      // indistinguishable from a rendering bug.
      console.error(
        `[stargazer] WebGPU device lost (${info.reason}): ${info.message}`,
      )
      for (const cb of this.#lostCbs) cb()
    })
  }

  // --- shaders --------------------------------------------------------------

  createShaderModule(desc: ShaderModuleDesc): ShaderModule {
    if (!desc.wgsl) {
      throw new Error(
        'WebGPUDevice.createShaderModule: no WGSL source in the shader module',
      )
    }
    const module = this.#device.createShaderModule({
      code: desc.wgsl.code,
      label: desc.label,
    })
    return {
      __gfxShader: undefined as never,
      module,
      vertexEntry: desc.wgsl.vertexEntry,
      fragmentEntry: desc.wgsl.fragmentEntry,
      computeEntry: desc.wgsl.computeEntry,
    } as WebGPUShader
  }

  deleteShaderModule(_s: ShaderModule): void {
    // WebGPU shader modules are garbage-collected. There is no explicit
    // destroy, so dropping the handle reference is enough.
    void _s
  }

  // --- pipelines ------------------------------------------------------------

  async createPipeline(desc: PipelineDesc): Promise<Pipeline> {
    const key = pipelineKey(desc)
    const cached = this.#pipelineCache.get(key)
    if (cached) return cached
    const device = this.#device
    const shader = desc.shader as WebGPUShader

    const layout = device.createPipelineLayout({
      bindGroupLayouts: desc.bindGroupLayouts.map(
        (bgl) => (bgl as WebGPUBindGroupLayout).gpu,
      ),
      label: desc.label,
    })

    const buffers: GPUVertexBufferLayout[] = desc.vertexLayout.map((l) => ({
      arrayStride: l.arrayStride,
      stepMode: l.stepMode,
      attributes: l.attributes.map((a) => ({
        shaderLocation: a.location,
        offset: a.offset,
        format: vertexFormatToGPU(a.format),
      })),
    }))

    const descriptor: GPURenderPipelineDescriptor = {
      label: desc.label,
      layout,
      vertex: {
        module: shader.module,
        entryPoint: shader.vertexEntry,
        buffers,
      },
      primitive: {
        topology: topologyToGPU(desc.primitive),
        cullMode: cullModeToGPU(desc.cull),
        frontFace: frontFaceToGPU(desc.frontFace),
      },
      multisample: { count: sampleCountToGPU(desc.samples) },
    }

    if (desc.color !== null) {
      descriptor.fragment = {
        module: shader.module,
        entryPoint: shader.fragmentEntry,
        targets: [colorTargetToGPU(desc.color, this.#canvasFormat)],
      }
    }

    const depthStencil = depthStencilToGPU(desc)
    if (depthStencil) descriptor.depthStencil = depthStencil

    const gpu = await device.createRenderPipelineAsync(descriptor)
    const pipeline: WebGPUPipeline = {
      __gfxPipeline: undefined as never,
      gpu,
      vertexLayout: desc.vertexLayout,
      stencilRef: desc.stencil?.reference ?? 0,
    } as WebGPUPipeline
    this.#pipelineCache.set(key, pipeline)
    return pipeline
  }

  async createComputePipeline(
    desc: ComputePipelineDesc,
  ): Promise<ComputePipeline> {
    const device = this.#device
    const shader = desc.shader as WebGPUShader
    if (!shader.computeEntry) {
      throw new Error(
        'WebGPUDevice.createComputePipeline: shader has no compute entry point',
      )
    }
    const layout = device.createPipelineLayout({
      bindGroupLayouts: desc.bindGroupLayouts.map(
        (bgl) => (bgl as WebGPUBindGroupLayout).gpu,
      ),
      label: desc.label,
    })
    const gpu = await device.createComputePipelineAsync({
      label: desc.label,
      layout,
      compute: { module: shader.module, entryPoint: shader.computeEntry },
    })
    return {
      __gfxComputePipeline: undefined as never,
      gpu,
    } as WebGPUComputePipeline
  }

  // --- bind groups ----------------------------------------------------------

  createBindGroupLayout(entries: BindGroupLayoutEntry[]): BindGroupLayout {
    const gpuEntries: GPUBindGroupLayoutEntry[] = []
    // Every binding is visible to all stages a resource of its kind may be read
    // in: the layouts are small and this avoids tracking which stage each
    // resource is used in. Storage textures are the exception. WebGPU forbids
    // them in the vertex stage, so they take FRAGMENT | COMPUTE only.
    const vis =
      GPUShaderStage.VERTEX | GPUShaderStage.FRAGMENT | GPUShaderStage.COMPUTE
    for (const e of entries) {
      if (e.type === 'uniform-buffer') {
        gpuEntries.push({
          binding: e.binding,
          visibility: vis,
          buffer: { type: 'uniform', hasDynamicOffset: !!e.dynamicOffset },
        })
        continue
      }
      if (e.type === 'data-table') {
        gpuEntries.push({
          binding: e.binding,
          visibility: vis,
          buffer: { type: 'read-only-storage' },
        })
        continue
      }
      if (e.type === 'storage-texture-2d') {
        gpuEntries.push({
          binding: e.binding,
          visibility: GPUShaderStage.FRAGMENT | GPUShaderStage.COMPUTE,
          storageTexture: {
            access: e.storageAccess ?? 'write-only',
            format: colorFormatToGPU(
              e.storageFormat ?? 'linear',
              this.#canvasFormat,
            ),
            viewDimension: '2d',
          },
        })
        continue
      }
      if (e.type === 'texture-2d-depth') {
        // Sampled depth read with a non-comparison, non-filtering sampler.
        gpuEntries.push({
          binding: e.binding,
          visibility: vis,
          texture: { sampleType: 'depth' },
        })
        gpuEntries.push({
          binding: e.binding + 16,
          visibility: vis,
          sampler: { type: 'non-filtering' },
        })
        continue
      }
      // Texture and its companion sampler at binding + 16.
      if (e.type === 'texture-2d') {
        gpuEntries.push({
          binding: e.binding,
          visibility: vis,
          texture: { sampleType: 'float' },
        })
        gpuEntries.push({
          binding: e.binding + 16,
          visibility: vis,
          sampler: { type: 'filtering' },
        })
      } else if (e.type === 'texture-2d-array-shadow') {
        gpuEntries.push({
          binding: e.binding,
          visibility: vis,
          texture: { sampleType: 'depth', viewDimension: '2d-array' },
        })
        gpuEntries.push({
          binding: e.binding + 16,
          visibility: vis,
          sampler: { type: 'comparison' },
        })
      } else {
        // texture-cube-shadow
        gpuEntries.push({
          binding: e.binding,
          visibility: vis,
          texture: { sampleType: 'depth', viewDimension: 'cube' },
        })
        gpuEntries.push({
          binding: e.binding + 16,
          visibility: vis,
          sampler: { type: 'comparison' },
        })
      }
    }
    const gpu = this.#device.createBindGroupLayout({ entries: gpuEntries })
    return {
      __gfxBindGroupLayout: undefined as never,
      gpu,
      entries: entries.slice(),
    } as WebGPUBindGroupLayout
  }

  createBindGroup(
    layout: BindGroupLayout,
    entries: BindGroupEntry[],
  ): BindGroup {
    this.deviceStats.bindGroupsCreated++
    const l = layout as WebGPUBindGroupLayout
    const gpuEntries: GPUBindGroupEntry[] = []
    for (const e of entries) {
      const le = l.entries.find((x) => x.binding === e.binding)
      if (!le) {
        throw new Error(
          `WebGPUDevice.createBindGroup: binding ${e.binding} not in layout`,
        )
      }
      const res = e.resource
      if ('uniformBuffer' in res) {
        const ubo = res.uniformBuffer as WebGPUUniformBuffer
        gpuEntries.push({
          binding: e.binding,
          resource: {
            buffer: ubo.gpu,
            offset: res.offset ?? 0,
            // `size` fixes the bound slice length. Required for dynamic entries.
            size: res.size,
          },
        })
      } else if ('dataTable' in res) {
        gpuEntries.push({
          binding: e.binding,
          resource: { buffer: (res.dataTable as WebGPUDataTable).gpu },
        })
      } else if ('texture' in res) {
        const tex = res.texture as WebGPUTexture
        gpuEntries.push({
          binding: e.binding,
          resource: tex.gpu.createView(),
        })
        // A storage texture binds without a sampler. A sampled depth texture
        // takes a non-filtering sampler, and a regular texture its filtering one.
        if (le.type === 'storage-texture-2d') {
          // no companion sampler
        } else if (le.type === 'texture-2d-depth') {
          gpuEntries.push({
            binding: e.binding + 16,
            resource:
              this.#nonFilteringSampler ??
              (this.#nonFilteringSampler = this.#device.createSampler({
                magFilter: 'nearest',
                minFilter: 'nearest',
                addressModeU: 'clamp-to-edge',
                addressModeV: 'clamp-to-edge',
              })),
          })
        } else {
          gpuEntries.push({
            binding: e.binding + 16,
            resource: this.#filterSampler(
              tex.filter,
              tex.wrap,
              tex.mipmap ? tex.anisotropy : 1,
            ),
          })
        }
      } else if ('shadowArray' in res) {
        const sa = res.shadowArray as WebGPUShadowArray
        gpuEntries.push({
          binding: e.binding,
          resource: sa.gpu.createView({ dimension: '2d-array' }),
        })
        gpuEntries.push({
          binding: e.binding + 16,
          resource: this.#comparisonSampler(sa.compare),
        })
      } else {
        const sc = res.shadowCube as WebGPUShadowCube
        gpuEntries.push({
          binding: e.binding,
          resource: sc.gpu.createView({ dimension: 'cube' }),
        })
        gpuEntries.push({
          binding: e.binding + 16,
          resource: this.#comparisonSampler(sc.compare),
        })
      }
    }
    const gpu = this.#device.createBindGroup({
      layout: l.gpu,
      entries: gpuEntries,
    })
    return { __gfxBindGroup: undefined as never, gpu } as WebGPUBindGroup
  }

  deleteBindGroup(_g: BindGroup): void {
    // Bind groups hold no GPU objects that need an explicit release (they
    // reference buffers / textures). The handle is garbage-collected.
    void _g
  }

  /**
   * A cached sampler for one combination of filter, wrap and anisotropy.
   *
   * Anisotropy belongs in the key, not just the descriptor. Samplers are shared
   * across every texture that matches, so keying on filter and wrap alone would
   * hand the first caller's anisotropy to everyone after it.
   *
   * WebGPU rejects `maxAnisotropy` above 1 unless all three filters are
   * `'linear'`, and it means nothing without a mip chain, so both are enforced
   * here rather than trusted from the caller. The cap of 16 is the highest any
   * driver exposes, and an out-of-range request is a validation error on some
   * backends.
   */
  #filterSampler(
    filter: 'nearest' | 'linear',
    wrap: 'clamp' | 'repeat',
    anisotropy = 1,
  ): GPUSampler {
    const aniso =
      filter === 'linear'
        ? Math.min(16, Math.max(1, Math.floor(anisotropy)))
        : 1
    const key = `${filter}/${wrap}/${aniso}`
    let s = this.#filterSamplers.get(key)
    if (s) return s
    const addressMode: GPUAddressMode =
      wrap === 'repeat' ? 'repeat' : 'clamp-to-edge'
    const gpuFilter: GPUFilterMode = filter === 'nearest' ? 'nearest' : 'linear'
    s = this.#device.createSampler({
      magFilter: gpuFilter,
      minFilter: gpuFilter,
      mipmapFilter: gpuFilter,
      addressModeU: addressMode,
      addressModeV: addressMode,
      addressModeW: addressMode,
      maxAnisotropy: aniso,
    })
    this.#filterSamplers.set(key, s)
    return s
  }

  #comparisonSampler(compare: CompareFn): GPUSampler {
    let s = this.#comparisonSamplers.get(compare)
    if (s) return s
    s = this.#device.createSampler({
      compare: compareFnToGPU(compare),
      magFilter: 'linear',
      minFilter: 'linear',
      addressModeU: 'clamp-to-edge',
      addressModeV: 'clamp-to-edge',
    })
    this.#comparisonSamplers.set(compare, s)
    return s
  }

  // --- vertex buffers -------------------------------------------------------

  createVertexBuffer(byteSize: number): VBuffer {
    const size = roundUp4(byteSize)
    const gpu = this.#device.createBuffer({
      size,
      usage: GPUBufferUsage.VERTEX | GPUBufferUsage.COPY_DST,
    })
    return {
      __gfxBuffer: undefined as never,
      gpu,
      byteSize: size,
    } as WebGPUBuffer
  }

  updateBufferSubData(
    buf: VBuffer,
    byteOffset: number,
    src: ArrayBufferView,
    srcOffsetBytes = 0,
    byteLength?: number,
  ): void {
    const b = buf as WebGPUBuffer
    this.#writeBuffer(b.gpu, byteOffset, src, srcOffsetBytes, byteLength)
  }

  deleteBuffer(buf: VBuffer): void {
    this.#destroyDeferred((buf as WebGPUBuffer).gpu)
  }

  #writeBuffer(
    gpu: GPUBuffer,
    byteOffset: number,
    src: ArrayBufferView,
    srcOffsetBytes: number,
    byteLength: number | undefined,
  ): void {
    const size =
      byteLength !== undefined ? byteLength : src.byteLength - srcOffsetBytes
    this.#writeAligned(
      gpu,
      byteOffset,
      src.buffer,
      src.byteOffset + srcOffsetBytes,
      size,
    )
  }

  /**
   * Write a raw byte range into a GPU buffer. `queue.writeBuffer` requires the
   * write size be a multiple of 4, which a u16 index array with an odd count
   * (or any short tail) violates, so a short write is copied into a 4-padded
   * staging array first. The destination is always allocated `roundUp4`, so the
   * padding bytes stay in bounds and no draw references them.
   */
  #writeAligned(
    gpu: GPUBuffer,
    byteOffset: number,
    srcBuffer: ArrayBufferLike,
    srcByteOffset: number,
    size: number,
  ): void {
    if (size % 4 === 0) {
      this.#device.queue.writeBuffer(
        gpu,
        byteOffset,
        srcBuffer,
        srcByteOffset,
        size,
      )
      return
    }
    const padded = roundUp4(size)
    const staging = new Uint8Array(padded)
    staging.set(new Uint8Array(srcBuffer, srcByteOffset, size))
    this.#device.queue.writeBuffer(gpu, byteOffset, staging.buffer, 0, padded)
  }

  // --- uniform buffers ------------------------------------------------------

  createUniformBuffer(byteSize: number): UBuffer {
    const size = roundUp4(byteSize)
    const gpu = this.#device.createBuffer({
      size,
      usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
    })
    return {
      __gfxUniformBuffer: undefined as never,
      gpu,
      byteSize: size,
    } as WebGPUUniformBuffer
  }

  updateUniformBuffer(
    buf: UBuffer,
    data: ArrayBufferView,
    byteOffset = 0,
  ): void {
    this.deviceStats.uniformWrites++
    const b = buf as WebGPUUniformBuffer
    this.#writeAligned(
      b.gpu,
      byteOffset,
      data.buffer,
      data.byteOffset,
      data.byteLength,
    )
  }

  deleteUniformBuffer(buf: UBuffer): void {
    this.#destroyDeferred((buf as WebGPUUniformBuffer).gpu)
  }

  // --- data tables ----------------------------------------------------------

  createDataTable(vec4Count: number): DataTable {
    if (vec4Count > this.limits.maxDataTableVec4) {
      throw new Error(
        `WebGPUDevice.createDataTable: ${vec4Count} elements exceed the limit ${this.limits.maxDataTableVec4}`,
      )
    }
    const gpu = this.#device.createBuffer({
      size: Math.max(1, vec4Count) * 16,
      usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST,
    })
    return {
      __gfxDataTable: undefined as never,
      capacity: Math.max(1, vec4Count),
      gpu,
    } as WebGPUDataTable
  }

  updateDataTable(
    table: DataTable,
    firstVec4: number,
    data: Float32Array,
  ): void {
    if (firstVec4 + (data.length >> 2) > table.capacity) {
      throw new Error('WebGPUDevice.updateDataTable: range past the capacity')
    }
    this.#device.queue.writeBuffer(
      (table as WebGPUDataTable).gpu,
      firstVec4 * 16,
      data.buffer as ArrayBuffer,
      data.byteOffset,
      data.byteLength,
    )
  }

  deleteDataTable(table: DataTable): void {
    this.#destroyDeferred((table as WebGPUDataTable).gpu)
  }

  // --- index buffers --------------------------------------------------------

  createIndexBuffer(byteSize: number, type: IndexType = 'u16'): IBuffer {
    const size = roundUp4(byteSize)
    const gpu = this.#device.createBuffer({
      size,
      usage: GPUBufferUsage.INDEX | GPUBufferUsage.COPY_DST,
    })
    return {
      __gfxIndexBuffer: undefined as never,
      gpu,
      byteSize: size,
      indexType: type,
    } as WebGPUIndexBuffer
  }

  updateIndexBufferSubData(
    buf: IBuffer,
    byteOffset: number,
    src: Uint16Array | Uint32Array,
  ): void {
    const b = buf as WebGPUIndexBuffer
    this.#writeAligned(
      b.gpu,
      byteOffset,
      src.buffer,
      src.byteOffset,
      src.byteLength,
    )
  }

  deleteIndexBuffer(buf: IBuffer): void {
    this.#destroyDeferred((buf as WebGPUIndexBuffer).gpu)
  }

  // --- textures -------------------------------------------------------------

  createTexture2D(opts: Texture2DOpts): Texture {
    const filter = opts.filter ?? 'linear'
    const wrap = opts.wrap ?? 'clamp'
    const srgb = opts.srgb ?? false
    const mipmap = opts.mipmap ?? false
    const width = Math.max(1, opts.width)
    const height = Math.max(1, opts.height)
    const mipLevelCount = mipmap ? mipLevels(width, height) : 1
    const pixelFormat = opts.pixelFormat ?? 'rgba8'
    const gpu = this.#device.createTexture({
      size: [width, height, 1],
      format: texturePixelFormatToGPU(pixelFormat, srgb),
      usage:
        GPUTextureUsage.TEXTURE_BINDING |
        GPUTextureUsage.COPY_DST |
        GPUTextureUsage.RENDER_ATTACHMENT |
        (opts.storage ? GPUTextureUsage.STORAGE_BINDING : 0),
      mipLevelCount,
    })
    return {
      __gfxTexture: undefined as never,
      gpu,
      width,
      height,
      filter,
      wrap,
      srgb,
      mipmap,
      anisotropy: opts.anisotropy ?? 1,
      pixelFormat,
      owned: true,
    } as WebGPUTexture
  }

  updateTexture2DData(tex: Texture, data: ArrayBufferView): void {
    const t = tex as WebGPUTexture
    this.#device.queue.writeTexture(
      { texture: t.gpu },
      data as GPUAllowSharedBufferSource,
      {
        bytesPerRow: t.width * texturePixelBytes(t.pixelFormat),
        rowsPerImage: t.height,
      },
      [t.width, t.height, 1],
    )
  }

  updateTextureSubImage2D(
    tex: Texture,
    xOffset: number,
    yOffset: number,
    source: TexImageSource,
    opts: TextureUploadOpts = {},
  ): void {
    const t = tex as WebGPUTexture
    this.#uploadImage(t.gpu, xOffset, yOffset, source, opts)
    if (t.mipmap) {
      this.#blit.generateMips(
        t.gpu,
        t.srgb ? 'rgba8unorm-srgb' : 'rgba8unorm',
        t.width,
        t.height,
      )
    }
  }

  updateTexture2D(
    tex: Texture,
    source: TexImageSource | null,
    opts: TextureUploadOpts = {},
  ): void {
    const t = tex as WebGPUTexture
    if (source === null) {
      // Reallocate storage at the current size (drops old contents).
      t.gpu.destroy()
      t.gpu = this.#device.createTexture({
        size: [t.width, t.height, 1],
        format: t.srgb ? 'rgba8unorm-srgb' : 'rgba8unorm',
        usage:
          GPUTextureUsage.TEXTURE_BINDING |
          GPUTextureUsage.COPY_DST |
          GPUTextureUsage.RENDER_ATTACHMENT,
        mipLevelCount: t.mipmap ? mipLevels(t.width, t.height) : 1,
      })
      return
    }
    const w = getSourceWidth(source)
    const h = getSourceHeight(source)
    if (w !== t.width || h !== t.height) {
      // Reallocate to the new source size, matching the WebGL2 reupload path.
      t.gpu.destroy()
      ;(t as { width: number }).width = w
      ;(t as { height: number }).height = h
      t.gpu = this.#device.createTexture({
        size: [w, h, 1],
        format: t.srgb ? 'rgba8unorm-srgb' : 'rgba8unorm',
        usage:
          GPUTextureUsage.TEXTURE_BINDING |
          GPUTextureUsage.COPY_DST |
          GPUTextureUsage.RENDER_ATTACHMENT,
        mipLevelCount: t.mipmap ? mipLevels(w, h) : 1,
      })
    }
    this.#uploadImage(t.gpu, 0, 0, source, opts)
    if (t.mipmap) {
      this.#blit.generateMips(
        t.gpu,
        t.srgb ? 'rgba8unorm-srgb' : 'rgba8unorm',
        t.width,
        t.height,
      )
    }
  }

  /**
   * Upload an image source into a texture. WebGPU's
   * `copyExternalImageToTexture` accepts only ImageBitmap / canvas / image /
   * video, not `ImageData` (which WebGL2's `texImage2D` does), so an
   * `ImageData` goes through `writeTexture` as raw RGBA8 bytes, applying
   * `flipY` / `premultiply` on the CPU since `writeTexture` does neither.
   *
   * `flipY` comes from `resolveUploadFlipY` and is never inverted per backend.
   * See that function for the shared contract and the regression it guards.
   */
  #uploadImage(
    gpu: GPUTexture,
    x: number,
    y: number,
    source: TexImageSource,
    opts: TextureUploadOpts,
  ): void {
    // `copyExternalImageToTexture` rejects `ImageData` on every backend, and
    // Firefox rejects sources this path should otherwise accept. Route ImageData
    // straight to the raw-bytes path, and fall back to it (for the session) the
    // first time the fast path throws, so a browser gap degrades instead of
    // faulting the frame.
    if (
      (typeof ImageData !== 'undefined' && source instanceof ImageData) ||
      this.#copyExternalBroken
    ) {
      this.#uploadViaBytes(gpu, x, y, source, opts)
      return
    }
    try {
      this.#device.queue.copyExternalImageToTexture(
        { source, flipY: resolveUploadFlipY(opts) },
        {
          texture: gpu,
          origin: [x, y, 0],
          premultipliedAlpha: opts.premultiply ?? false,
        },
        [getSourceWidth(source), getSourceHeight(source), 1],
      )
    } catch (err) {
      this.#copyExternalBroken = true
      console.warn(
        '[stargazer] copyExternalImageToTexture failed; using a writeTexture fallback for the rest of the session:',
        err,
      )
      this.#uploadViaBytes(gpu, x, y, source, opts)
    }
  }

  /** Rasterize any image source to RGBA8 bytes and upload via `writeTexture`. */
  #uploadViaBytes(
    gpu: GPUTexture,
    x: number,
    y: number,
    source: TexImageSource,
    opts: TextureUploadOpts,
  ): void {
    if (typeof ImageData !== 'undefined' && source instanceof ImageData) {
      this.#writeImageData(gpu, x, y, source, opts)
      return
    }
    const w = getSourceWidth(source)
    const h = getSourceHeight(source)
    if (w === 0 || h === 0) return
    const canvas = new OffscreenCanvas(w, h)
    const ctx = canvas.getContext('2d')
    if (!ctx) return
    ctx.drawImage(source as CanvasImageSource, 0, 0)
    this.#writeImageData(gpu, x, y, ctx.getImageData(0, 0, w, h), opts)
  }

  #writeImageData(
    gpu: GPUTexture,
    x: number,
    y: number,
    img: ImageData,
    opts: TextureUploadOpts,
  ): void {
    const w = img.width
    const h = img.height
    // writeTexture applies neither flipY nor premultiply, so bake both into a
    // fresh, plainly-backed byte array CPU-side.
    const out = packUploadRGBA(img, opts)
    this.#device.queue.writeTexture(
      { texture: gpu, origin: [x, y, 0] },
      out,
      { bytesPerRow: w * 4, rowsPerImage: h },
      [w, h, 1],
    )
  }

  deleteTexture(tex: Texture): void {
    const t = tex as WebGPUTexture
    // A `colorTexture` view handle borrows a render target's texture. Only the
    // render target destroys it.
    if (t.owned) this.#destroyDeferred(t.gpu)
  }

  // --- render targets -------------------------------------------------------

  createRenderTarget(opts: RenderTargetOpts): RenderTarget {
    const device = this.#device
    const samples = sampleCountToGPU(opts.samples ?? 1)
    const width = Math.max(1, opts.width)
    const height = Math.max(1, opts.height)
    const colorSpace: ColorFormat = opts.colorSpace ?? 'linear'
    const pixelFormat: TargetPixelFormat = opts.pixelFormat ?? 'rgba8'
    if (pixelFormat !== 'rgba8' && samples > 1) {
      throw new Error(
        `WebGPUDevice.createRenderTarget: pixelFormat '${pixelFormat}' is single-sample only (no renderable multisample R8/RG8 target)`,
      )
    }
    const format =
      colorSpace === 'canvas' && pixelFormat === 'rgba8'
        ? this.#canvasFormat
        : targetPixelFormatToGPU(pixelFormat)
    const aspects = depthStencilFormatFor(opts)

    const rt: WebGPURenderTarget = {
      __gfxRenderTarget: undefined as never,
      width,
      height,
      samples,
      colorSpace,
      pixelFormat,
      colorFormat: format,
      hasDepth: hasDepthAspect(aspects),
      hasStencil: hasStencilAspect(aspects),
    } as WebGPURenderTarget

    if (samples > 1) {
      // A multisample color attachment cannot be sampled. It only renders and
      // resolves. The single-sample sampleable color lives in the resolve
      // target the caller supplies to the pass.
      rt.colorMs = device.createTexture({
        size: [width, height, 1],
        format,
        sampleCount: samples,
        usage: GPUTextureUsage.RENDER_ATTACHMENT,
      })
    } else {
      rt.color = device.createTexture({
        size: [width, height, 1],
        format,
        usage: this.#colorUsage(format),
      })
    }

    // Stencil without depth is its own quarter-sized attachment. Depth, with or
    // without stencil, is one texture in `depthTex` carrying both aspects.
    if (aspects === 'stencil') {
      rt.stencilTex = device.createTexture({
        size: [width, height, 1],
        format: 'stencil8',
        sampleCount: samples,
        usage: GPUTextureUsage.RENDER_ATTACHMENT,
      })
    } else if (hasDepthAspect(aspects)) {
      // A sampleable depth attachment (the AO G-buffer) is single-sample and
      // adds TEXTURE_BINDING so a later pass can read it as `texture_depth_2d`.
      // `depthStencilFormatFor` drops stencil in that case, so the sampled view
      // is always depth-only and needs no aspect of its own.
      rt.depthSampled = !!opts.depthSampled
      rt.depthFormat = depthStencilFormatToGPU(aspects) ?? 'depth24plus'
      rt.depthTex = device.createTexture({
        size: [width, height, 1],
        format: rt.depthFormat,
        sampleCount: rt.depthSampled ? 1 : samples,
        usage:
          GPUTextureUsage.RENDER_ATTACHMENT |
          (rt.depthSampled ? GPUTextureUsage.TEXTURE_BINDING : 0),
      })
    }
    return rt
  }

  resizeRenderTarget(rt: RenderTarget, width: number, height: number): void {
    const r = rt as WebGPURenderTarget
    const w = Math.max(1, width)
    const h = Math.max(1, height)
    if (r.width === w && r.height === h) return
    const device = this.#device
    const format = r.colorFormat
    if (r.colorMs) {
      r.colorMs.destroy()
      r.colorMs = device.createTexture({
        size: [w, h, 1],
        format,
        sampleCount: r.samples,
        usage: GPUTextureUsage.RENDER_ATTACHMENT,
      })
    }
    if (r.color) {
      r.color.destroy()
      r.color = device.createTexture({
        size: [w, h, 1],
        format,
        usage: this.#colorUsage(format),
      })
    }
    if (r.depthTex) {
      r.depthTex.destroy()
      r.depthTex = device.createTexture({
        size: [w, h, 1],
        format: r.depthFormat ?? 'depth24plus',
        sampleCount: r.depthSampled ? 1 : r.samples,
        usage:
          GPUTextureUsage.RENDER_ATTACHMENT |
          (r.depthSampled ? GPUTextureUsage.TEXTURE_BINDING : 0),
      })
    }
    if (r.stencilTex) {
      r.stencilTex.destroy()
      r.stencilTex = device.createTexture({
        size: [w, h, 1],
        format: 'stencil8',
        sampleCount: r.samples,
        usage: GPUTextureUsage.RENDER_ATTACHMENT,
      })
    }
    ;(r as { width: number }).width = w
    ;(r as { height: number }).height = h
  }

  /** A color texture is sampleable, and copyable when it matches the canvas. */
  #colorUsage(format: GPUTextureFormat): GPUTextureUsageFlags {
    return (
      GPUTextureUsage.RENDER_ATTACHMENT |
      GPUTextureUsage.TEXTURE_BINDING |
      (format === this.#canvasFormat ? GPUTextureUsage.COPY_SRC : 0)
    )
  }

  canvasTarget(): RenderTarget {
    if (!this.#canvasTarget) {
      const context = this.#context
      const canvas = (): { width: number; height: number } =>
        context.canvas as HTMLCanvasElement
      this.#canvasTarget = {
        __gfxRenderTarget: undefined as never,
        get width() {
          return Math.max(1, canvas().width)
        },
        get height() {
          return Math.max(1, canvas().height)
        },
        samples: 1,
        colorSpace: 'canvas',
        pixelFormat: 'rgba8',
        colorFormat: this.#canvasFormat,
        hasDepth: false,
        hasStencil: false,
        isCanvas: true,
        get color() {
          return context.getCurrentTexture()
        },
      } as WebGPURenderTarget
    }
    return this.#canvasTarget
  }

  deleteRenderTarget(rt: RenderTarget): void {
    const r = rt as WebGPURenderTarget
    if (r.isCanvas) return
    if (r.color) this.#destroyDeferred(r.color)
    if (r.colorMs) this.#destroyDeferred(r.colorMs)
    if (r.depthTex) this.#destroyDeferred(r.depthTex)
    if (r.stencilTex) this.#destroyDeferred(r.stencilTex)
  }

  colorTexture(rt: RenderTarget): Texture {
    const r = rt as WebGPURenderTarget
    if (r.samples > 1 || !r.color || r.isCanvas) {
      throw new Error(
        'WebGPUDevice.colorTexture: target is multisample or the canvas (not sampleable); resolve it first',
      )
    }
    // Borrow the render target's color texture. `owned: false` keeps
    // `deleteTexture` from destroying a texture the target still holds.
    return {
      __gfxTexture: undefined as never,
      gpu: r.color,
      width: r.width,
      height: r.height,
      filter: 'linear',
      wrap: 'clamp',
      srgb: r.colorSpace === 'srgb',
      mipmap: false,
      anisotropy: 1,
      pixelFormat: r.pixelFormat,
      owned: false,
    } as WebGPUTexture
  }

  depthTexture(rt: RenderTarget): Texture {
    const r = rt as WebGPURenderTarget
    if (!r.depthTex || !r.depthSampled) {
      throw new Error(
        'WebGPUDevice.depthTexture: target has no sampleable depth attachment (allocate with depthSampled: true)',
      )
    }
    // Borrow the render target's depth texture. The target owns its lifetime.
    return {
      __gfxTexture: undefined as never,
      gpu: r.depthTex,
      width: r.width,
      height: r.height,
      filter: 'nearest',
      wrap: 'clamp',
      srgb: false,
      mipmap: false,
      anisotropy: 1,
      // A depth texture has no color layout. It is never uploaded to.
      pixelFormat: 'rgba8',
      owned: false,
    } as WebGPUTexture
  }

  // --- shadow maps ----------------------------------------------------------

  createShadowArray(
    size: number,
    layers: number,
    compare: CompareFn = 'less-equal',
  ): ShadowArray {
    const gpu = this.#device.createTexture({
      size: [size, size, layers],
      format: 'depth24plus',
      usage:
        GPUTextureUsage.RENDER_ATTACHMENT | GPUTextureUsage.TEXTURE_BINDING,
      dimension: '2d',
    })
    return {
      __gfxShadowArray: undefined as never,
      gpu,
      size,
      layers,
      compare,
    } as WebGPUShadowArray
  }

  createShadowCube(
    size: number,
    compare: CompareFn = 'less-equal',
  ): ShadowCube {
    const gpu = this.#device.createTexture({
      size: [size, size, 6],
      format: 'depth24plus',
      usage:
        GPUTextureUsage.RENDER_ATTACHMENT | GPUTextureUsage.TEXTURE_BINDING,
      dimension: '2d',
      // The cube sampling view is created on demand in `createBindGroup`. The
      // storage is a 6-layer 2D texture.
      textureBindingViewDimension: 'cube',
    })
    return {
      __gfxShadowCube: undefined as never,
      gpu,
      size,
      compare,
    } as WebGPUShadowCube
  }

  deleteShadowArray(s: ShadowArray): void {
    ;(s as WebGPUShadowArray).gpu.destroy()
  }

  deleteShadowCube(s: ShadowCube): void {
    ;(s as WebGPUShadowCube).gpu.destroy()
  }

  // --- frame lifecycle & passes ---------------------------------------------

  beginFrame(): void {
    this.deviceStats.pipelineSwitches = 0
    this.deviceStats.textureBinds = 0
    // The engine opens render passes for the shadow and AO pre-passes
    // BEFORE `beginFrame`, so the encoder is lazy: whichever pass comes first
    // in the frame opens it, everything up to `endFrame` shares it (one submit,
    // ordered so a pass that writes a texture precedes one that samples it).
    this.#ensureEncoder()
  }

  #ensureEncoder(): void {
    if (!this.#encoder) this.#encoder = this.#device.createCommandEncoder()
  }

  beginRenderPass(desc: RenderPassDesc): void {
    this.deviceStats.passes++
    this.#ensureEncoder()
    const encoder = this.#encoder!
    const descriptor: GPURenderPassDescriptor = { colorAttachments: [] }
    const writes = this.#timestampWrites()
    if (writes) descriptor.timestampWrites = writes

    if (desc.color) {
      const target = desc.color.target as WebGPURenderTarget
      const multisample = target.samples > 1
      const view = multisample
        ? target.colorMs!.createView()
        : target.color!.createView()
      const attachment: GPURenderPassColorAttachment = {
        view,
        loadOp: desc.color.loadOp,
        storeOp: desc.color.storeOp ?? 'store',
      }
      if (multisample && desc.color.resolveTarget) {
        const resolve = desc.color.resolveTarget as WebGPURenderTarget
        attachment.resolveTarget = resolve.color!.createView()
      }
      if (desc.color.loadOp === 'clear') {
        const c = desc.color.clearColor ?? [0, 0, 0, 0]
        // Premultiplied clear for the premultiplied surface.
        attachment.clearValue = {
          r: c[0] * c[3],
          g: c[1] * c[3],
          b: c[2] * c[3],
          a: c[3],
        }
      }
      descriptor.colorAttachments = [attachment]
    }

    // The attachment's own format decides which ops the pass carries. WebGPU
    // rejects a pass that omits ops for an aspect the format has, and equally
    // one that supplies ops for an aspect it lacks, so neither can be driven by
    // which of `desc.depth` / `desc.stencil` the caller happened to fill in.
    if (desc.depth || desc.stencil) {
      const attachment = this.#depthStencilAttachment(desc)
      if (attachment) descriptor.depthStencilAttachment = attachment
    }

    this.#pass = encoder.beginRenderPass(descriptor)
    this.#lastPipeline = null
    this.#bindings.reset()
    this.#stencilRef = 0
    this.#scissorSet = false
    this.#scissorKey = ''
    const size = desc.color?.target ?? desc.stencil?.target
    this.#passW = size?.width ?? 0
    this.#passH = size?.height ?? 0
  }

  /**
   * The pass's depth-stencil attachment, built from the aspects its target
   * actually carries.
   *
   * An aspect the caller described nothing for is cleared rather than loaded. A
   * load would be legal (WebGPU zero-initializes lazily) but leaves depth at
   * `0.0`, which fails the engine's `less-equal` default for every fragment and
   * makes 3D content vanish with no error to trace it by.
   */
  #depthStencilAttachment(
    desc: RenderPassDesc,
  ): GPURenderPassDepthStencilAttachment | null {
    // A shadow pass targets an array layer or cube face, which is depth-only
    // and has no render target to read a format from.
    if (desc.depth && !('renderTarget' in desc.depth.target)) {
      return {
        view: this.#depthView(desc.depth.target),
        depthLoadOp: desc.depth.loadOp,
        depthStoreOp: desc.depth.storeOp ?? 'store',
        depthClearValue: desc.depth.clearValue ?? 1.0,
      }
    }

    const target = (
      desc.depth && 'renderTarget' in desc.depth.target
        ? desc.depth.target.renderTarget
        : desc.stencil?.target
    ) as WebGPURenderTarget | undefined
    if (!target) return null
    const aspects = depthStencilFormatOf(target)
    if (aspects === 'none') return null

    const view = (
      aspects === 'stencil' ? target.stencilTex : target.depthTex
    )?.createView()
    if (!view) {
      throw new Error(
        `WebGPUDevice.beginRenderPass: target reports '${aspects}' but has no matching attachment`,
      )
    }

    const attachment: GPURenderPassDepthStencilAttachment = { view }
    if (hasDepthAspect(aspects)) {
      attachment.depthLoadOp = desc.depth?.loadOp ?? 'clear'
      attachment.depthStoreOp = desc.depth?.storeOp ?? 'store'
      if (attachment.depthLoadOp === 'clear') {
        attachment.depthClearValue = desc.depth?.clearValue ?? 1.0
      }
    }
    if (hasStencilAspect(aspects)) {
      attachment.stencilLoadOp = desc.stencil?.loadOp ?? 'clear'
      attachment.stencilStoreOp = desc.stencil?.storeOp ?? 'store'
      if (attachment.stencilLoadOp === 'clear') {
        attachment.stencilClearValue = desc.stencil?.clearValue ?? 0
      }
    }
    return attachment
  }

  /** Resolve a `DepthTarget` union to the depth view a pass writes into. */
  #depthView(target: DepthTarget): GPUTextureView {
    if ('renderTarget' in target) {
      const rt = target.renderTarget as WebGPURenderTarget
      if (!rt.depthTex) {
        throw new Error(
          'WebGPUDevice.beginRenderPass: depth target has no depth attachment',
        )
      }
      return rt.depthTex.createView()
    }
    if ('shadowArray' in target) {
      const sa = target.shadowArray as WebGPUShadowArray
      return sa.gpu.createView({
        dimension: '2d',
        baseArrayLayer: target.layer,
        arrayLayerCount: 1,
      })
    }
    const sc = target.shadowCube as WebGPUShadowCube
    return sc.gpu.createView({
      dimension: '2d',
      baseArrayLayer: target.face,
      arrayLayerCount: 1,
    })
  }

  endRenderPass(): void {
    if (!this.#pass) return
    this.#pass.end()
    this.#pass = null
    this.#lastPipeline = null
  }

  beginComputePass(): void {
    this.deviceStats.passes++
    this.#ensureEncoder()
    const writes = this.#timestampWrites()
    this.#computePass = this.#encoder!.beginComputePass(
      writes ? { timestampWrites: writes } : undefined,
    )
  }

  dispatchCompute(dispatch: ComputeDispatch): void {
    const pass = this.#computePass
    if (!pass) {
      throw new Error('WebGPUDevice.dispatchCompute: no open compute pass')
    }
    const p = dispatch.pipeline as WebGPUComputePipeline
    pass.setPipeline(p.gpu)
    for (const dg of dispatch.bindGroups) {
      const bg = dg.bindGroup as WebGPUBindGroup
      if (dg.dynamicOffsets && dg.dynamicOffsets.length > 0) {
        pass.setBindGroup(dg.group, bg.gpu, dg.dynamicOffsets)
      } else {
        pass.setBindGroup(dg.group, bg.gpu)
      }
    }
    pass.dispatchWorkgroups(dispatch.x, dispatch.y ?? 1, dispatch.z ?? 1)
  }

  endComputePass(): void {
    if (!this.#computePass) return
    this.#computePass.end()
    this.#computePass = null
  }

  endFrame(): void {
    this.#flush()
  }

  /**
   * Submit whatever the frame encoder holds and close it. Safe to call at any
   * point outside a render pass, and a no-op when nothing is recorded.
   */
  #flush(): void {
    if (!this.#encoder) return
    this.deviceStats.submits++
    const readback = this.#resolveTimestamps(this.#encoder)
    this.#device.queue.submit([this.#encoder.finish()])
    this.#encoder = null
    this.#drainPendingDestroy()
    if (readback) this.#readTimestamps(readback)
  }

  // --- GPU frame timing -----------------------------------------------------

  readonly #timeListeners = new Set<(ms: number) => void>()
  #querySet: GPUQuerySet | null = null
  #queryResolve: GPUBuffer | null = null
  /** Readback buffers not waiting on a map. */
  readonly #queryReadbacks: GPUBuffer[] = []
  #queryBuffersMade = 0
  /** Whether a pass since the last submit has written the start timestamp. */
  #timedSinceSubmit = false
  /** The query slot the current submit writes, one pair of timestamps each. */
  #querySlot = 0
  /** The slot the previous submit wrote, resolved by this one, or -1. */
  #queryPending = -1

  onGpuFrameTime(listener: (ms: number) => void): (() => void) | null {
    if (!this.#device.features.has('timestamp-query')) return null
    if (!this.#querySet) {
      this.#querySet = this.#device.createQuerySet({
        type: 'timestamp',
        count: QUERY_SLOTS * 2,
      })
      this.#queryResolve = this.#device.createBuffer({
        size: 16,
        usage: GPUBufferUsage.QUERY_RESOLVE | GPUBufferUsage.COPY_SRC,
      })
    }
    this.#timeListeners.add(listener)
    return () => this.#timeListeners.delete(listener)
  }

  /**
   * The timestamp writes for a pass while a listener waits: the first pass
   * after a submit writes the start, and every pass writes the end, so the last
   * pass's end stands.
   */
  #timestampWrites(): GPURenderPassTimestampWrites | undefined {
    if (this.#timeListeners.size === 0 || !this.#querySet) return undefined
    const first = !this.#timedSinceSubmit
    this.#timedSinceSubmit = true
    const base = this.#querySlot * 2
    return first
      ? {
          querySet: this.#querySet,
          beginningOfPassWriteIndex: base,
          endOfPassWriteIndex: base + 1,
        }
      : { querySet: this.#querySet, endOfPassWriteIndex: base + 1 }
  }

  /**
   * Copy out the timestamps of the previous submit, or skip when no readback is
   * free. A submit's own end timestamp can land after a resolve in the same
   * submit, so each pair is read one submit later from its own slot.
   */
  #resolveTimestamps(encoder: GPUCommandEncoder): GPUBuffer | null {
    const prev = this.#queryPending
    this.#queryPending = -1
    if (this.#timedSinceSubmit) {
      this.#queryPending = this.#querySlot
      this.#querySlot = (this.#querySlot + 1) % QUERY_SLOTS
    }
    this.#timedSinceSubmit = false
    if (prev < 0 || !this.#querySet || !this.#queryResolve) return null
    let readback = this.#queryReadbacks.pop()
    if (!readback) {
      // Enough in flight to cover the frames a map takes to come back under
      // load. A frame with none free goes untimed.
      if (this.#queryBuffersMade >= 8) return null
      this.#queryBuffersMade++
      readback = this.#device.createBuffer({
        size: 16,
        usage: GPUBufferUsage.MAP_READ | GPUBufferUsage.COPY_DST,
      })
    }
    encoder.resolveQuerySet(this.#querySet, prev * 2, 2, this.#queryResolve, 0)
    encoder.copyBufferToBuffer(this.#queryResolve, 0, readback, 0, 16)
    return readback
  }

  #readTimestamps(readback: GPUBuffer): void {
    readback.mapAsync(GPUMapMode.READ).then(
      () => {
        const t = new BigUint64Array(readback.getMappedRange())
        const ns = t[1] > t[0] ? Number(t[1] - t[0]) : 0
        readback.unmap()
        this.#queryReadbacks.push(readback)
        if (ns > 0) {
          for (const listener of this.#timeListeners) listener(ns / 1e6)
        }
      },
      () => {
        // A lost device rejects the map. The buffer goes with it.
      },
    )
  }

  /**
   * Destroy `resource` now, or after the next submit when a command encoder is
   * open and could already name it. See {@link #pendingDestroy}.
   */
  #destroyDeferred(resource: { destroy(): void }): void {
    if (this.#encoder) this.#pendingDestroy.push(resource)
    else resource.destroy()
  }

  #drainPendingDestroy(): void {
    if (this.#pendingDestroy.length === 0) return
    for (const resource of this.#pendingDestroy) resource.destroy()
    this.#pendingDestroy.length = 0
  }

  // --- draw -----------------------------------------------------------------

  draw(call: DrawCall): void {
    const pass = this.#pass
    if (!pass) {
      throw new Error('WebGPUDevice.draw: no open render pass')
    }
    const p = call.pipeline as WebGPUPipeline
    if (this.#lastPipeline !== p.gpu) {
      pass.setPipeline(p.gpu)
      this.#lastPipeline = p.gpu
      this.deviceStats.pipelineSwitches++
    }
    const ref = call.stencilReference ?? p.stencilRef
    if (ref !== this.#stencilRef) {
      pass.setStencilReference(ref)
      this.#stencilRef = ref
    }
    this.#applyScissor(pass, call.scissor)
    for (let i = 0; i < call.vertexBuffers.length; i++) {
      const vb = call.vertexBuffers[i]
      const gpu = (vb.buffer as WebGPUBuffer).gpu
      if (this.#bindings.vertexBufferChanged(i, gpu, vb.offset)) {
        pass.setVertexBuffer(i, gpu, vb.offset)
      }
    }
    for (const dg of call.bindGroups) {
      const bg = dg.bindGroup as WebGPUBindGroup
      if (!this.#bindings.bindGroupChanged(dg.group, bg.gpu, dg.dynamicOffsets))
        continue
      if (dg.dynamicOffsets && dg.dynamicOffsets.length > 0) {
        pass.setBindGroup(dg.group, bg.gpu, dg.dynamicOffsets)
      } else {
        pass.setBindGroup(dg.group, bg.gpu)
      }
      this.deviceStats.bindGroupSwitches++
    }

    const first = call.first ?? 0
    const instances = call.instanceCount ?? 1
    if (call.indexBuffer) {
      const ib = call.indexBuffer as WebGPUIndexBuffer
      const format = indexTypeToGPU(ib.indexType)
      if (this.#bindings.indexBufferChanged(ib.gpu, format)) {
        pass.setIndexBuffer(ib.gpu, format)
      }
      pass.drawIndexed(call.indexCount ?? 0, instances, first, 0, 0)
    } else {
      pass.draw(call.vertexCount ?? 0, instances, first, 0)
    }
  }

  /**
   * Set the scissor for a draw, clamped to the pass target. A draw without one
   * restores the full target, but only after an earlier draw narrowed it.
   */
  #applyScissor(
    pass: GPURenderPassEncoder,
    rect: ScissorRect | undefined,
  ): void {
    if (!rect) {
      if (this.#scissorSet && this.#passW > 0) {
        pass.setScissorRect(0, 0, this.#passW, this.#passH)
        this.#scissorSet = false
        this.#scissorKey = ''
      }
      return
    }
    const x = Math.max(0, Math.min(this.#passW, Math.floor(rect.x)))
    const y = Math.max(0, Math.min(this.#passH, Math.floor(rect.y)))
    const w = Math.max(
      0,
      Math.min(this.#passW - x, Math.ceil(rect.x + rect.w) - x),
    )
    const h = Math.max(
      0,
      Math.min(this.#passH - y, Math.ceil(rect.y + rect.h) - y),
    )
    const key = `${x},${y},${w},${h}`
    if (key === this.#scissorKey) return
    pass.setScissorRect(x, y, w, h)
    this.#scissorKey = key
    this.#scissorSet = true
  }

  // --- present --------------------------------------------------------------

  present(
    source: RenderTarget,
    dstWidth: number,
    dstHeight: number,
    opts: BlitOpts = {},
  ): void {
    void dstWidth
    void dstHeight
    const r = source as WebGPURenderTarget
    if (!r.color) {
      throw new Error(
        'WebGPUDevice.present: source is multisample (not sampleable); resolve it first',
      )
    }
    const canvasTexture = this.#context.getCurrentTexture()
    if (
      r.colorFormat === canvasTexture.format &&
      r.width === canvasTexture.width &&
      r.height === canvasTexture.height
    ) {
      // Same format and size: a copy on the frame's encoder, ordered after the
      // passes that drew the source and submitted with them.
      this.#ensureEncoder()
      this.#encoder!.copyTextureToTexture(
        { texture: r.color },
        { texture: canvasTexture },
        [r.width, r.height, 1],
      )
      return
    }
    // Any other source needs a draw. The blit runs on an encoder of its own and
    // submits at once, so work still recorded in the frame encoder is submitted
    // first or the blit would sample whatever the source held beforehand.
    this.#flush()
    this.deviceStats.submits++
    // The source is top-down, matching the swapchain, so the blit does not
    // V-flip.
    this.#blit.blit(
      r.color.createView(),
      canvasTexture.createView(),
      opts.filter === 'nearest' ? 'nearest' : 'linear',
    )
  }

  // --- context loss ---------------------------------------------------------

  isContextLost(): boolean {
    return this.#lost
  }

  onContextLost(cb: () => void): () => void {
    this.#lostCbs.add(cb)
    return () => this.#lostCbs.delete(cb)
  }

  onContextRestored(cb: () => void): () => void {
    // WebGPU has no device-restored event: a lost device is gone for good and a
    // new one must be requested. Callbacks are stored to match the WebGL2
    // registry shape but never fire.
    this.#restoredCbs.add(cb)
    return () => this.#restoredCbs.delete(cb)
  }

  destroy(): void {
    this.#destroying = true
    this.#lostCbs.clear()
    this.#restoredCbs.clear()
    // Anything still queued dies with the device below, so drop the queue
    // rather than destroying each resource against a device going away.
    this.#pendingDestroy.length = 0
    try {
      this.#context.unconfigure()
    } catch {
      // Unconfigure can throw if the context is already gone. Ignore.
    }
    this.#device.destroy()
    this.#lost = true
  }
}
