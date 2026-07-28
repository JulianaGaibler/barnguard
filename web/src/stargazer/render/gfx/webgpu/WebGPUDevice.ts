/**
 * WebGPU implementation of `GfxDevice`. Owns a `GPUDevice` and its canvas
 * context and implements the pipeline/bind-group/render-pass model directly:
 * a frame is a `GPUCommandEncoder`, a pass is a `GPURenderPassEncoder` with its
 * attachments and load/store ops, a pipeline is an immutable `GPURenderPipeline`
 * memoized by descriptor, and a bind group resolves to a `GPUBindGroup`.
 *
 * Acquisition is async (`navigator.gpu.requestAdapter` / `requestDevice`) while
 * the interface is mostly synchronous, so construction goes through the static
 * `WebGPUDevice.create` factory and the constructor is private: by the time the
 * device exists the `GPUDevice`, context, and preferred format are all in hand.
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
  RenderTarget,
  RenderTargetOpts,
  ShaderModule,
  ShaderModuleDesc,
  ShadowArray,
  ShadowCube,
  Texture,
  Texture2DOpts,
  TextureUploadOpts,
  UBuffer,
  VBuffer,
  VertexBufferLayout,
} from '../GfxDevice'
import {
  blendToGPU,
  colorFormatToGPU,
  compareFnToGPU,
  cullModeToGPU,
  frontFaceToGPU,
  indexTypeToGPU,
  roundUp4,
  topologyToGPU,
  vertexFormatToGPU,
} from './conv'

// --- concrete backing structs (kept private, exposed as branded handles) ----

interface WebGPUShader extends ShaderModule {
  module: GPUShaderModule
  vertexEntry: string
  fragmentEntry: string
}

interface WebGPUPipeline extends Pipeline {
  gpu: GPURenderPipeline
  vertexLayout: VertexBufferLayout[]
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
  /** Sampleable single-sample color texture (present unless MSAA is on). */
  color?: GPUTexture
  /** Multisample color texture, allocated only when `samples > 1`. */
  colorMs?: GPUTexture
  depthTex?: GPUTexture
  width: number
  height: number
  samples: number
}

// --- device -----------------------------------------------------------------

export class WebGPUDevice implements GfxDevice {
  readonly #device: GPUDevice
  readonly #context: GPUCanvasContext
  readonly #preferredFormat: GPUTextureFormat

  #lost = false
  #destroying = false
  /** Latched once `copyExternalImageToTexture` throws (a browser gap). */
  #copyExternalBroken = false
  readonly #lostCbs = new Set<() => void>()
  readonly #restoredCbs = new Set<() => void>()

  /** The frame's command encoder, open between `beginFrame` and `endFrame`. */
  #encoder: GPUCommandEncoder | null = null
  /** The current render pass, open between `beginRenderPass`/`endRenderPass`. */
  #pass: GPURenderPassEncoder | null = null
  /** Last pipeline set on the open pass, for the `pipelineSwitches` stat. */
  #lastPipeline: GPURenderPipeline | null = null

  // Cached samplers reused across bind groups. Regular textures share one
  // filtering sampler per (filter, wrap). Shadows share a comparison sampler
  // per CompareFn.
  readonly #filterSamplers = new Map<string, GPUSampler>()
  readonly #comparisonSamplers = new Map<CompareFn, GPUSampler>()

  // Lazily-built present blit resources (one fullscreen-triangle pipeline plus a
  // pair of samplers keyed by filter).
  #blitModule: GPUShaderModule | null = null
  #blitLayout: GPUBindGroupLayout | null = null
  #blitPipeline: GPURenderPipeline | null = null
  readonly #blitSamplers = new Map<'nearest' | 'linear', GPUSampler>()

  // Mipmap-generation pipelines, one per color format (reuses the blit module).
  readonly #mipPipelines = new Map<GPUTextureFormat, GPURenderPipeline>()

  readonly deviceStats: DeviceStats = {
    pipelineSwitches: 0,
    bindGroupSwitches: 0,
    textureBinds: 0,
  }

  readonly limits: DeviceLimits

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

  /** Pipeline memoization: descriptor key → pipeline. */
  readonly #pipelineCache = new Map<string, WebGPUPipeline>()

  /**
   * Acquire an adapter + device, configure the canvas for WebGPU, and build a
   * device. Async because adapter/device acquisition is. Throws a clear error if
   * WebGPU is unavailable or the adapter/device request fails.
   */
  static async create(canvas: HTMLCanvasElement): Promise<WebGPUDevice> {
    if (!navigator.gpu) {
      throw new Error('WebGPUDevice: navigator.gpu is unavailable (no WebGPU)')
    }
    const adapter = await navigator.gpu.requestAdapter()
    if (!adapter) {
      throw new Error('WebGPUDevice: requestAdapter returned null')
    }
    const device = await adapter.requestDevice()
    if (!device) {
      throw new Error('WebGPUDevice: requestDevice returned null')
    }
    const context = canvas.getContext('webgpu')
    if (!context) {
      throw new Error('WebGPUDevice: failed to acquire a webgpu context')
    }
    const format = navigator.gpu.getPreferredCanvasFormat()
    context.configure({ device, format, alphaMode: 'premultiplied' })
    return new WebGPUDevice(device, context, format)
  }

  private constructor(
    device: GPUDevice,
    context: GPUCanvasContext,
    preferredFormat: GPUTextureFormat,
  ) {
    this.#device = device
    this.#context = context
    this.#preferredFormat = preferredFormat
    this.limits = {
      minUniformBufferOffsetAlignment:
        device.limits.minUniformBufferOffsetAlignment,
    }
    // A device loss fires once and never restores. Ignore the loss that a
    // deliberate `destroy` triggers so teardown doesn't spuriously fire the
    // context-loss callbacks.
    void device.lost.then((info) => {
      if (this.#destroying) return
      this.#lost = true
      void info
      for (const cb of this.#lostCbs) cb()
    })
  }

  /** MSAA is capped at 4× (the value WebGPU guarantees for a `count`). */
  #clampSamples(samples: number): number {
    if (samples <= 1) return 1
    return Math.min(4, Math.floor(samples))
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
      multisample: { count: this.#clampSamples(desc.samples) },
    }

    if (desc.color !== null) {
      descriptor.fragment = {
        module: shader.module,
        entryPoint: shader.fragmentEntry,
        targets: [
          {
            format: colorFormatToGPU(desc.color.format),
            blend: blendToGPU(desc.color.blend),
            writeMask: GPUColorWrite.ALL,
          },
        ],
      }
    }

    if (desc.depth !== null) {
      const d = desc.depth
      descriptor.depthStencil = {
        format: 'depth24plus',
        depthWriteEnabled: d.write,
        depthCompare: d.test ? compareFnToGPU(d.compare ?? 'less-equal') : 'always',
        depthBias: d.biasConstant ?? 0,
        depthBiasSlopeScale: d.biasSlopeScale ?? 0,
      }
    }

    const gpu = await device.createRenderPipelineAsync(descriptor)
    const pipeline: WebGPUPipeline = {
      __gfxPipeline: undefined as never,
      gpu,
      vertexLayout: desc.vertexLayout,
    } as WebGPUPipeline
    this.#pipelineCache.set(key, pipeline)
    return pipeline
  }

  // --- bind groups ----------------------------------------------------------

  createBindGroupLayout(entries: BindGroupLayoutEntry[]): BindGroupLayout {
    const gpuEntries: GPUBindGroupLayoutEntry[] = []
    // Both stages see every binding: the layouts are small and this avoids
    // tracking which stage each resource is read in.
    const vis = GPUShaderStage.VERTEX | GPUShaderStage.FRAGMENT
    for (const e of entries) {
      if (e.type === 'uniform-buffer') {
        gpuEntries.push({
          binding: e.binding,
          visibility: vis,
          buffer: { type: 'uniform', hasDynamicOffset: !!e.dynamicOffset },
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
      } else if ('texture' in res) {
        const tex = res.texture as WebGPUTexture
        gpuEntries.push({
          binding: e.binding,
          resource: tex.gpu.createView(),
        })
        gpuEntries.push({
          binding: e.binding + 16,
          resource: this.#filterSampler(tex.filter, tex.wrap),
        })
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

  #filterSampler(
    filter: 'nearest' | 'linear',
    wrap: 'clamp' | 'repeat',
  ): GPUSampler {
    const key = `${filter}/${wrap}`
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
    ;(buf as WebGPUBuffer).gpu.destroy()
  }

  orphanBuffer(buf: VBuffer): void {
    const b = buf as WebGPUBuffer
    b.gpu.destroy()
    b.gpu = this.#device.createBuffer({
      size: b.byteSize,
      usage: GPUBufferUsage.VERTEX | GPUBufferUsage.COPY_DST,
    })
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
    this.#writeAligned(gpu, byteOffset, src.buffer, src.byteOffset + srcOffsetBytes, size)
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
      this.#device.queue.writeBuffer(gpu, byteOffset, srcBuffer, srcByteOffset, size)
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

  updateUniformBuffer(buf: UBuffer, data: ArrayBufferView, byteOffset = 0): void {
    const b = buf as WebGPUUniformBuffer
    this.#writeAligned(
      b.gpu,
      byteOffset,
      data.buffer,
      data.byteOffset,
      data.byteLength,
    )
  }

  orphanUniformBuffer(buf: UBuffer): void {
    const b = buf as WebGPUUniformBuffer
    b.gpu.destroy()
    b.gpu = this.#device.createBuffer({
      size: b.byteSize,
      usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
    })
  }

  deleteUniformBuffer(buf: UBuffer): void {
    ;(buf as WebGPUUniformBuffer).gpu.destroy()
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
    this.#writeAligned(b.gpu, byteOffset, src.buffer, src.byteOffset, src.byteLength)
  }

  deleteIndexBuffer(buf: IBuffer): void {
    ;(buf as WebGPUIndexBuffer).gpu.destroy()
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
    const gpu = this.#device.createTexture({
      size: [width, height, 1],
      format: srgb ? 'rgba8unorm-srgb' : 'rgba8unorm',
      usage:
        GPUTextureUsage.TEXTURE_BINDING |
        GPUTextureUsage.COPY_DST |
        GPUTextureUsage.RENDER_ATTACHMENT,
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
      owned: true,
    } as WebGPUTexture
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
      this.#generateMips(t.gpu, t.srgb ? 'rgba8unorm-srgb' : 'rgba8unorm', t.width, t.height)
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
      this.#generateMips(t.gpu, t.srgb ? 'rgba8unorm-srgb' : 'rgba8unorm', t.width, t.height)
    }
  }

  /**
   * Upload an image source into a texture. WebGPU's `copyExternalImageToTexture`
   * accepts only ImageBitmap / canvas / image / video, not `ImageData` (which
   * WebGL2's `texImage2D` does), so an `ImageData` goes through `writeTexture`
   * as raw RGBA8 bytes, applying `flipY` / `premultiply` on the CPU since
   * `writeTexture` does neither.
   */
  /**
   * The `flipY` an upload must use. The 2D pass samples textures with UVs that
   * share the render target's V orientation, and that orientation differs
   * between backends, so a screen-space texture flips relative to its WebGL
   * `flipY` to sample the same way. A mesh's object-space UVs are independent of
   * the render target, so those upload with their `flipY` unchanged (else the
   * texture samples upside-down).
   */
  #uploadFlipY(opts: TextureUploadOpts): boolean {
    if (opts.objectSpaceUV) return opts.flipY ?? false
    return !(opts.flipY ?? false)
  }

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
        { source, flipY: this.#uploadFlipY(opts) },
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
    const flip = this.#uploadFlipY(opts)
    const premul = opts.premultiply ?? false
    // Copy into a fresh, plainly-backed byte array (also applies flipY /
    // premultiply, which writeTexture does not do itself).
    const out = new Uint8Array(w * h * 4)
    for (let row = 0; row < h; row++) {
      const srcRow = flip ? h - 1 - row : row
      for (let col = 0; col < w; col++) {
        const si = (srcRow * w + col) * 4
        const di = (row * w + col) * 4
        const a = img.data[si + 3]
        const s = premul ? a / 255 : 1
        out[di] = Math.round(img.data[si] * s)
        out[di + 1] = Math.round(img.data[si + 1] * s)
        out[di + 2] = Math.round(img.data[si + 2] * s)
        out[di + 3] = a
      }
    }
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
    if (t.owned) t.gpu.destroy()
  }

  // --- render targets -------------------------------------------------------

  createRenderTarget(opts: RenderTargetOpts): RenderTarget {
    const device = this.#device
    const samples = this.#clampSamples(opts.samples ?? 1)
    const width = Math.max(1, opts.width)
    const height = Math.max(1, opts.height)
    const colorSpace: ColorFormat = opts.colorSpace ?? 'linear'
    const format = colorFormatToGPU(colorSpace)

    const rt: WebGPURenderTarget = {
      __gfxRenderTarget: undefined as never,
      width,
      height,
      samples,
      colorSpace,
      hasDepth: !!opts.depth,
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
        usage:
          GPUTextureUsage.RENDER_ATTACHMENT | GPUTextureUsage.TEXTURE_BINDING,
      })
    }

    if (opts.depth) {
      rt.depthTex = device.createTexture({
        size: [width, height, 1],
        format: 'depth24plus',
        sampleCount: samples,
        usage: GPUTextureUsage.RENDER_ATTACHMENT,
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
    const format = colorFormatToGPU(r.colorSpace)
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
        usage:
          GPUTextureUsage.RENDER_ATTACHMENT | GPUTextureUsage.TEXTURE_BINDING,
      })
    }
    if (r.depthTex) {
      r.depthTex.destroy()
      r.depthTex = device.createTexture({
        size: [w, h, 1],
        format: 'depth24plus',
        sampleCount: r.samples,
        usage: GPUTextureUsage.RENDER_ATTACHMENT,
      })
    }
    ;(r as { width: number }).width = w
    ;(r as { height: number }).height = h
  }

  deleteRenderTarget(rt: RenderTarget): void {
    const r = rt as WebGPURenderTarget
    r.color?.destroy()
    r.colorMs?.destroy()
    r.depthTex?.destroy()
  }

  colorTexture(rt: RenderTarget): Texture {
    const r = rt as WebGPURenderTarget
    if (r.samples > 1 || !r.color) {
      throw new Error(
        'WebGPUDevice.colorTexture: target is multisample (not sampleable); resolve it first',
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

  createShadowCube(size: number, compare: CompareFn = 'less-equal'): ShadowCube {
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
    this.deviceStats.bindGroupSwitches = 0
    this.deviceStats.textureBinds = 0
    // The engine opens render passes for the shadow / Viewport2D pre-passes
    // BEFORE `beginFrame`, so the encoder is lazy: whichever pass comes first
    // in the frame opens it, everything up to `endFrame` shares it (one submit,
    // ordered so a pass that writes a texture precedes one that samples it).
    this.#ensureEncoder()
  }

  #ensureEncoder(): void {
    if (!this.#encoder) this.#encoder = this.#device.createCommandEncoder()
  }

  beginRenderPass(desc: RenderPassDesc): void {
    this.#ensureEncoder()
    const encoder = this.#encoder!
    const descriptor: GPURenderPassDescriptor = { colorAttachments: [] }

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

    if (desc.depth) {
      descriptor.depthStencilAttachment = {
        view: this.#depthView(desc.depth.target),
        depthLoadOp: desc.depth.loadOp,
        depthStoreOp: desc.depth.storeOp ?? 'store',
        depthClearValue: desc.depth.clearValue ?? 1.0,
      }
    }

    this.#pass = encoder.beginRenderPass(descriptor)
    this.#lastPipeline = null
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

  endFrame(): void {
    if (!this.#encoder) return
    this.#device.queue.submit([this.#encoder.finish()])
    this.#encoder = null
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
    for (let i = 0; i < call.vertexBuffers.length; i++) {
      const vb = call.vertexBuffers[i]
      pass.setVertexBuffer(i, (vb.buffer as WebGPUBuffer).gpu, vb.offset)
    }
    for (const dg of call.bindGroups) {
      const bg = dg.bindGroup as WebGPUBindGroup
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
      pass.setIndexBuffer(ib.gpu, indexTypeToGPU(ib.indexType))
      pass.drawIndexed(call.indexCount ?? 0, instances, first, 0, 0)
    } else {
      pass.draw(call.vertexCount ?? 0, instances, first, 0)
    }
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
    this.#ensureBlit()
    const device = this.#device
    const filter = opts.filter === 'nearest' ? 'nearest' : 'linear'
    const bindGroup = device.createBindGroup({
      layout: this.#blitLayout!,
      entries: [
        { binding: 0, resource: r.color.createView() },
        { binding: 1, resource: this.#blitSampler(filter) },
      ],
    })
    // A fresh encoder + pass targets the swapchain texture. Present runs outside
    // the frame's render pass.
    const encoder = device.createCommandEncoder()
    const pass = encoder.beginRenderPass({
      colorAttachments: [
        {
          view: this.#context.getCurrentTexture().createView(),
          loadOp: 'clear',
          storeOp: 'store',
          clearValue: { r: 0, g: 0, b: 0, a: 0 },
        },
      ],
    })
    pass.setPipeline(this.#blitPipeline!)
    pass.setBindGroup(0, bindGroup)
    pass.draw(3, 1, 0, 0)
    pass.end()
    device.queue.submit([encoder.finish()])
  }

  #blitSampler(filter: 'nearest' | 'linear'): GPUSampler {
    let s = this.#blitSamplers.get(filter)
    if (s) return s
    const f: GPUFilterMode = filter === 'nearest' ? 'nearest' : 'linear'
    s = this.#device.createSampler({
      magFilter: f,
      minFilter: f,
      addressModeU: 'clamp-to-edge',
      addressModeV: 'clamp-to-edge',
    })
    this.#blitSamplers.set(filter, s)
    return s
  }

  /**
   * Lazily build the fullscreen-triangle blit pipeline. The source render
   * target is stored top-down (`ndc.textureTopDown` is true), matching the
   * swapchain's top-left origin, so the blit samples the source UV directly
   * with NO V-flip: a WebGL blit ends up upright because WebGL stores bottom-up
   * and blits into a bottom-up default framebuffer, and the WebGPU path reaches
   * the same upright image by keeping both sides top-down. (Prime in-browser
   * verification point.)
   */
  #ensureBlit(): void {
    if (this.#blitPipeline) return
    const device = this.#device
    const code = `
struct VOut {
  @builtin(position) pos: vec4<f32>,
  @location(0) uv: vec2<f32>,
};

@vertex
fn vs_main(@builtin(vertex_index) vi: u32) -> VOut {
  // Oversized triangle covering the viewport. Clip xy in [-1,3], uv in [0,2].
  var out: VOut;
  let x = f32((vi << 1u) & 2u);
  let y = f32(vi & 2u);
  out.uv = vec2<f32>(x, y);
  out.pos = vec4<f32>(x * 2.0 - 1.0, 1.0 - y * 2.0, 0.0, 1.0);
  return out;
}

@group(0) @binding(0) var u_src: texture_2d<f32>;
@group(0) @binding(1) var u_srcSamp: sampler;

@fragment
fn fs_main(in: VOut) -> @location(0) vec4<f32> {
  return textureSample(u_src, u_srcSamp, in.uv);
}
`
    this.#blitModule = device.createShaderModule({ code, label: 'blit' })
    this.#blitLayout = device.createBindGroupLayout({
      entries: [
        {
          binding: 0,
          visibility: GPUShaderStage.FRAGMENT,
          texture: { sampleType: 'float' },
        },
        {
          binding: 1,
          visibility: GPUShaderStage.FRAGMENT,
          sampler: { type: 'filtering' },
        },
      ],
    })
    const pipelineLayout = device.createPipelineLayout({
      bindGroupLayouts: [this.#blitLayout],
    })
    this.#blitPipeline = device.createRenderPipeline({
      label: 'blit',
      layout: pipelineLayout,
      vertex: { module: this.#blitModule, entryPoint: 'vs_main' },
      fragment: {
        module: this.#blitModule,
        entryPoint: 'fs_main',
        targets: [{ format: this.#preferredFormat }],
      },
      primitive: { topology: 'triangle-list' },
    })
  }

  /**
   * Generate the mip chain for a just-uploaded texture. WebGPU has no automatic
   * mipmap generation (unlike WebGL's `generateMipmap`), so each level is
   * produced by rendering a fullscreen triangle that samples the level above
   * with a linear filter (a 2×2 box downsample). Runs on its own command
   * encoder, queued after the mip-0 upload so it reads a complete level.
   */
  #generateMips(gpu: GPUTexture, format: GPUTextureFormat, width: number, height: number): void {
    const levels = mipLevels(width, height)
    if (levels <= 1) return
    this.#ensureBlit() // builds the shared fullscreen-sample module + layout
    const device = this.#device
    const pipeline = this.#mipPipelineFor(format)
    const sampler = this.#blitSampler('linear')
    const encoder = device.createCommandEncoder()
    for (let level = 1; level < levels; level++) {
      const bindGroup = device.createBindGroup({
        layout: this.#blitLayout!,
        entries: [
          {
            binding: 0,
            resource: gpu.createView({
              baseMipLevel: level - 1,
              mipLevelCount: 1,
            }),
          },
          { binding: 1, resource: sampler },
        ],
      })
      const pass = encoder.beginRenderPass({
        colorAttachments: [
          {
            view: gpu.createView({ baseMipLevel: level, mipLevelCount: 1 }),
            loadOp: 'clear',
            storeOp: 'store',
            clearValue: { r: 0, g: 0, b: 0, a: 0 },
          },
        ],
      })
      pass.setPipeline(pipeline)
      pass.setBindGroup(0, bindGroup)
      pass.draw(3, 1, 0, 0)
      pass.end()
    }
    device.queue.submit([encoder.finish()])
  }

  #mipPipelineFor(format: GPUTextureFormat): GPURenderPipeline {
    let p = this.#mipPipelines.get(format)
    if (p) return p
    p = this.#device.createRenderPipeline({
      label: 'mipgen',
      layout: this.#device.createPipelineLayout({
        bindGroupLayouts: [this.#blitLayout!],
      }),
      vertex: { module: this.#blitModule!, entryPoint: 'vs_main' },
      fragment: {
        module: this.#blitModule!,
        entryPoint: 'fs_main',
        targets: [{ format }],
      },
      primitive: { topology: 'triangle-list' },
    })
    this.#mipPipelines.set(format, p)
    return p
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
    try {
      this.#context.unconfigure()
    } catch {
      // Unconfigure can throw if the context is already gone. Ignore.
    }
    this.#device.destroy()
    this.#lost = true
  }
}

// --- helpers ----------------------------------------------------------------

/** Full mip-chain length for a 2D texture of the given dimensions. */
function mipLevels(width: number, height: number): number {
  return 1 + Math.floor(Math.log2(Math.max(width, height)))
}

function getSourceWidth(source: TexImageSource): number {
  if ('width' in source && typeof source.width === 'number') return source.width
  return 0
}

function getSourceHeight(source: TexImageSource): number {
  if ('height' in source && typeof source.height === 'number') {
    return source.height
  }
  return 0
}

/**
 * Stable string key for pipeline memoization: handle identity for
 * shader/layouts (via ids assigned lazily), structural for the scalar fields.
 * Mirrors the WebGL2 backend's keying so the same descriptor reuses one
 * pipeline.
 */
const pipelineIdTag = Symbol('gfxPipelineIdWgpu')
let nextPipelineTagId = 1
function tagId(o: object): number {
  const rec = o as unknown as Record<symbol, number>
  if (!rec[pipelineIdTag]) rec[pipelineIdTag] = nextPipelineTagId++
  return rec[pipelineIdTag]
}

function pipelineKey(desc: PipelineDesc): string {
  const shaderId = tagId(desc.shader)
  const layoutIds = desc.bindGroupLayouts.map(tagId).join('.')
  const vtx = desc.vertexLayout
    .map(
      (l) =>
        `${l.arrayStride}:${l.stepMode[0]}:` +
        l.attributes
          .map((a) => `${a.location}/${a.format}/${a.offset}`)
          .join('-'),
    )
    .join(';')
  const color = desc.color ? `${desc.color.format}/${desc.color.blend}` : 'none'
  const depth = desc.depth
    ? `${desc.depth.test ? 1 : 0}${desc.depth.write ? 1 : 0}/${desc.depth.compare ?? 'le'}/${desc.depth.biasSlopeScale ?? 0}/${desc.depth.biasConstant ?? 0}`
    : 'none'
  return `s${shaderId}|bgl${layoutIds}|v${vtx}|c${color}|d${depth}|${desc.cull}|${desc.frontFace}|${desc.primitive}|x${desc.samples}`
}
