// Fullscreen-triangle blit + mipmap generation for the WebGPU backend. Both
// reuse one shader module and bind-group layout and only need the `GPUDevice`,
// so they live apart from the device's frame/pass state. `present` blits the
// resolved frame into the swapchain, texture upload calls `generateMips`
// (WebGPU has no `generateMipmap`). Resources build lazily on first use.

/** Full mip-chain length for a 2D texture of the given dimensions. */
export function mipLevels(width: number, height: number): number {
  return 1 + Math.floor(Math.log2(Math.max(width, height)))
}

const BLIT_WGSL = `
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

export class BlitPass {
  readonly #device: GPUDevice
  readonly #preferredFormat: GPUTextureFormat
  #module: GPUShaderModule | null = null
  #layout: GPUBindGroupLayout | null = null
  /** Present pipeline, targeting the swapchain's `preferredFormat`. */
  #pipeline: GPURenderPipeline | null = null
  readonly #samplers = new Map<'nearest' | 'linear', GPUSampler>()
  /** Mip-generation pipelines, one per color format (share the blit module). */
  readonly #mipPipelines = new Map<GPUTextureFormat, GPURenderPipeline>()

  constructor(device: GPUDevice, preferredFormat: GPUTextureFormat) {
    this.#device = device
    this.#preferredFormat = preferredFormat
  }

  /**
   * Blit `srcView` into `dstView` (which must be `preferredFormat`, i.e. the
   * swapchain) with a fullscreen triangle, on a fresh encoder submitted
   * immediately. The source is sampled with NO V-flip: the source render target
   * is stored top-down, matching the swapchain's top-left origin, so both sides
   * stay top-down and the image lands upright.
   */
  blit(
    srcView: GPUTextureView,
    dstView: GPUTextureView,
    filter: 'nearest' | 'linear',
  ): void {
    this.#ensure()
    const device = this.#device
    const bindGroup = device.createBindGroup({
      layout: this.#layout!,
      entries: [
        { binding: 0, resource: srcView },
        { binding: 1, resource: this.#sampler(filter) },
      ],
    })
    const encoder = device.createCommandEncoder()
    const pass = encoder.beginRenderPass({
      colorAttachments: [
        {
          view: dstView,
          loadOp: 'clear',
          storeOp: 'store',
          clearValue: { r: 0, g: 0, b: 0, a: 0 },
        },
      ],
    })
    pass.setPipeline(this.#pipeline!)
    pass.setBindGroup(0, bindGroup)
    pass.draw(3, 1, 0, 0)
    pass.end()
    device.queue.submit([encoder.finish()])
  }

  /**
   * Generate the mip chain for a just-uploaded texture. Each level is produced
   * by rendering a fullscreen triangle that samples the level above with a
   * linear filter (a 2×2 box downsample). Runs on its own command encoder,
   * queued after the mip-0 upload so it reads a complete level.
   */
  generateMips(
    gpu: GPUTexture,
    format: GPUTextureFormat,
    width: number,
    height: number,
  ): void {
    const levels = mipLevels(width, height)
    if (levels <= 1) return
    this.#ensure()
    const device = this.#device
    const pipeline = this.#mipPipelineFor(format)
    const sampler = this.#sampler('linear')
    const encoder = device.createCommandEncoder()
    for (let level = 1; level < levels; level++) {
      const bindGroup = device.createBindGroup({
        layout: this.#layout!,
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

  #sampler(filter: 'nearest' | 'linear'): GPUSampler {
    let s = this.#samplers.get(filter)
    if (s) return s
    const f: GPUFilterMode = filter === 'nearest' ? 'nearest' : 'linear'
    s = this.#device.createSampler({
      magFilter: f,
      minFilter: f,
      addressModeU: 'clamp-to-edge',
      addressModeV: 'clamp-to-edge',
    })
    this.#samplers.set(filter, s)
    return s
  }

  /** Lazily build the shared blit module + layout and the present pipeline. */
  #ensure(): void {
    if (this.#pipeline) return
    const device = this.#device
    this.#module = device.createShaderModule({ code: BLIT_WGSL, label: 'blit' })
    this.#layout = device.createBindGroupLayout({
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
    this.#pipeline = device.createRenderPipeline({
      label: 'blit',
      layout: device.createPipelineLayout({ bindGroupLayouts: [this.#layout] }),
      vertex: { module: this.#module, entryPoint: 'vs_main' },
      fragment: {
        module: this.#module,
        entryPoint: 'fs_main',
        targets: [{ format: this.#preferredFormat }],
      },
      primitive: { topology: 'triangle-list' },
    })
  }

  #mipPipelineFor(format: GPUTextureFormat): GPURenderPipeline {
    let p = this.#mipPipelines.get(format)
    if (p) return p
    p = this.#device.createRenderPipeline({
      label: 'mipgen',
      layout: this.#device.createPipelineLayout({
        bindGroupLayouts: [this.#layout!],
      }),
      vertex: { module: this.#module!, entryPoint: 'vs_main' },
      fragment: {
        module: this.#module!,
        entryPoint: 'fs_main',
        targets: [{ format }],
      },
      primitive: { topology: 'triangle-list' },
    })
    this.#mipPipelines.set(format, p)
    return p
  }
}
