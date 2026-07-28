/**
 * Test-only `GfxDevice` that records the command stream (pipelines, bind
 * groups, passes, draws, uploads) into in-memory lists. It emulates no GL state
 * — it hands back plausibly-shaped opaque handles and logs what was asked of
 * it, so program/renderer logic can be asserted without a real context. Handle
 * equality is by identity.
 */

import type {
  BindGroup,
  BindGroupEntry,
  BindGroupLayout,
  BindGroupLayoutEntry,
  BlitOpts,
  CompareFn,
  CullMode,
  DeviceLimits,
  NdcConventions,
  DeviceStats,
  DrawCall,
  GfxDevice,
  IBuffer,
  IndexType,
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
} from '../GfxDevice'

interface MockBuffer extends VBuffer {
  id: number
}
interface MockIndexBuffer extends IBuffer {
  id: number
  indexType: IndexType
}
interface MockPipeline extends Pipeline {
  desc: PipelineDesc
}
interface MockBindGroup extends BindGroup {
  layout: BindGroupLayout
  entries: BindGroupEntry[]
}

/**
 * A recorded draw, flattened for assertion. Alongside the raw `DrawCall` fields
 * it exposes semantics _derived_ from the pipeline + bind groups so tests can
 * assert on draw category, program identity, blend, and bound texture without
 * reaching into pipeline descriptors.
 */
export interface DrawRecord {
  pipeline: MockPipeline
  vertexBuffers: { buffer: VBuffer; offset: number }[]
  bindGroups: DrawCall['bindGroups']
  indexBuffer?: IBuffer
  vertexCount?: number
  indexCount?: number
  first: number
  instanceCount: number
  /** Snapshot of the last vertex buffer's most recent upload, for inspection. */
  bufferSnapshot?: ArrayBuffer
  // --- derived (for test assertions) ---------------------------------------
  /**
   * Draw category derived from the call shape: `'elements'` (indexed),
   * `'lines'` (line-list pipeline), `'instancedRange'` (an instanced program —
   * more than one vertex buffer, i.e. a unit quad + an instance buffer), else
   * `'arrays'`.
   */
  kind: 'arrays' | 'lines' | 'instancedRange' | 'elements'
  /** Element count: index count for indexed draws, else vertex count. */
  count: number
  /**
   * Program identity (the pipeline's shader module; stable across blend
   * variants).
   */
  program: ShaderModule | null
  /** The pipeline's blend mode. */
  blend: string
  /** First texture bound across the draw's bind groups, or `null`. */
  texture: Texture | null
}

/** One recorded render pass. */
export interface PassRecord {
  desc: RenderPassDesc
  drawCount: number
}

export class MockGfxDevice implements GfxDevice {
  readonly draws: DrawRecord[] = []
  readonly passes: PassRecord[] = []
  readonly shaders: ShaderModule[] = []
  readonly pipelines: MockPipeline[] = []
  readonly bindGroupLayouts: BindGroupLayout[] = []
  readonly bindGroups: BindGroup[] = []
  readonly buffers: VBuffer[] = []
  readonly textures: Texture[] = []
  readonly renderTargets: RenderTarget[] = []
  readonly shadowArrays: ShadowArray[] = []
  readonly shadowCubes: ShadowCube[] = []
  readonly boundTargets: RenderTarget[] = []
  readonly presents: {
    source: RenderTarget
    dstWidth: number
    dstHeight: number
  }[] = []
  deletedRenderTargets = 0

  readonly deviceStats: DeviceStats = {
    pipelineSwitches: 0,
    bindGroupSwitches: 0,
    textureBinds: 0,
  }
  readonly limits: DeviceLimits = { minUniformBufferOffsetAlignment: 256 }
  readonly ndc: NdcConventions = {
    clipDepth: 'neg-one-to-one',
    frontFace: 'ccw',
    textureTopDown: false,
  }

  // Derived device-level mirrors for tests that assert render state without
  // inspecting pipeline descriptors: the last-drawn pipeline's cull/depth, and
  // the shadow render passes begun/ended this session.
  cull: CullMode = 'none'
  depthTest = false
  depthWrite = true
  readonly shadowLayerBegins: number[] = []
  readonly shadowCubeFaceBegins: number[] = []
  shadowPassEnds = 0
  #curPassShadow = false

  #nextId = 1
  #curPipeline: MockPipeline | null = null
  #curPass: PassRecord | null = null
  #lastBufferBytes: ArrayBuffer | null = null
  #bufferBytes = new Map<VBuffer, ArrayBuffer>()
  #lostCbs = new Set<() => void>()
  #restoredCbs = new Set<() => void>()

  // --- shaders / pipelines / bind groups ------------------------------------

  createShaderModule(_desc: ShaderModuleDesc): ShaderModule {
    const s = { __gfxShader: undefined as never }
    this.shaders.push(s)
    return s
  }
  deleteShaderModule(_s: ShaderModule): void {
    /* noop */
  }
  createPipeline(desc: PipelineDesc): Promise<Pipeline> {
    const p = { __gfxPipeline: undefined as never, desc } as MockPipeline
    this.pipelines.push(p)
    return Promise.resolve(p)
  }
  createBindGroupLayout(_entries: BindGroupLayoutEntry[]): BindGroupLayout {
    const l = { __gfxBindGroupLayout: undefined as never }
    this.bindGroupLayouts.push(l)
    return l
  }
  createBindGroup(
    layout: BindGroupLayout,
    entries: BindGroupEntry[],
  ): BindGroup {
    const g = {
      __gfxBindGroup: undefined as never,
      layout,
      entries: entries.slice(),
    } as MockBindGroup
    this.bindGroups.push(g)
    return g
  }
  deleteBindGroup(_g: BindGroup): void {
    /* noop */
  }

  // --- vertex buffers -------------------------------------------------------

  createVertexBuffer(_byteSize: number): VBuffer {
    const b = {
      __gfxBuffer: undefined as never,
      id: this.#nextId++,
    } as MockBuffer
    this.buffers.push(b)
    return b
  }
  readonly uploads: Array<{ buffer: VBuffer; byteLength: number }> = []
  updateBufferSubData(
    buf: VBuffer,
    _byteOffset: number,
    src: ArrayBufferView,
    srcOffsetBytes = 0,
    byteLength?: number,
  ): void {
    const len = byteLength ?? src.byteLength - srcOffsetBytes
    const start = src.byteOffset + srcOffsetBytes
    this.#lastBufferBytes = (src.buffer as ArrayBuffer).slice(
      start,
      start + len,
    )
    this.#bufferBytes.set(buf, this.#lastBufferBytes)
    this.uploads.push({ buffer: buf, byteLength: len })
  }
  deleteBuffer(_b: VBuffer): void {
    /* noop */
  }
  orphanBuffer(_b: VBuffer): void {
    /* noop */
  }

  // --- uniform buffers ------------------------------------------------------

  readonly uniformBuffers: UBuffer[] = []
  readonly uniformUploads: Array<{
    buffer: UBuffer
    data: ArrayBufferView
    byteOffset: number
  }> = []
  createUniformBuffer(_byteSize: number): UBuffer {
    const b = { __gfxUniformBuffer: undefined as never }
    this.uniformBuffers.push(b)
    return b
  }
  updateUniformBuffer(
    buffer: UBuffer,
    data: ArrayBufferView,
    byteOffset = 0,
  ): void {
    // Copy so later caller mutations don't leak into the recorded value.
    const copy = new Uint8Array(data.byteLength)
    copy.set(
      new Uint8Array(
        data.buffer as ArrayBuffer,
        data.byteOffset,
        data.byteLength,
      ),
    )
    this.uniformUploads.push({ buffer, data: copy, byteOffset })
  }
  orphanUniformBuffer(_b: UBuffer): void {
    /* noop */
  }
  deleteUniformBuffer(_b: UBuffer): void {
    /* noop */
  }

  // --- index buffers --------------------------------------------------------

  readonly indexBuffers: IBuffer[] = []
  readonly indexUploads: Array<{ buffer: IBuffer; byteLength: number }> = []
  readonly indexBufferTypes: IndexType[] = []
  createIndexBuffer(_byteSize: number, type: IndexType = 'u16'): IBuffer {
    const b = {
      __gfxIndexBuffer: undefined as never,
      id: this.#nextId++,
      indexType: type,
    } as MockIndexBuffer
    this.indexBuffers.push(b)
    this.indexBufferTypes.push(type)
    return b
  }
  updateIndexBufferSubData(
    buffer: IBuffer,
    _byteOffset: number,
    src: Uint16Array | Uint32Array,
  ): void {
    this.indexUploads.push({ buffer, byteLength: src.byteLength })
  }
  deleteIndexBuffer(_b: IBuffer): void {
    /* noop */
  }

  // --- textures -------------------------------------------------------------

  createTexture2D(opts: Texture2DOpts): Texture {
    const t = {
      __gfxTexture: undefined as never,
      width: opts.width,
      height: opts.height,
    }
    this.textures.push(t)
    return t
  }
  updateTexture2D(
    _t: Texture,
    _s: TexImageSource | null,
    _o?: TextureUploadOpts,
  ): void {
    /* noop */
  }
  subImageUploads: Array<{ tex: Texture; x: number; y: number }> = []
  updateTextureSubImage2D(
    tex: Texture,
    xOffset: number,
    yOffset: number,
    _source: TexImageSource,
    _opts?: TextureUploadOpts,
  ): void {
    this.subImageUploads.push({ tex, x: xOffset, y: yOffset })
  }
  deleteTexture(_t: Texture): void {
    /* noop */
  }

  // --- render targets -------------------------------------------------------

  createRenderTarget(opts: RenderTargetOpts): RenderTarget {
    const samples = Math.max(1, Math.floor(opts.samples ?? 1))
    const rt = {
      __gfxRenderTarget: undefined as never,
      width: opts.width,
      height: opts.height,
      samples,
      hasDepth: opts.depth === true,
      colorSpace: opts.colorSpace ?? 'linear',
      color:
        samples === 1
          ? {
              __gfxTexture: undefined as never,
              width: opts.width,
              height: opts.height,
            }
          : undefined,
    }
    this.renderTargets.push(rt)
    return rt
  }
  resizeRenderTarget(_rt: RenderTarget, _w: number, _h: number): void {
    /* noop */
  }
  deleteRenderTarget(_rt: RenderTarget): void {
    this.deletedRenderTargets++
  }
  colorTexture(rt: RenderTarget): Texture {
    const c = (rt as { color?: Texture }).color
    if (!c) throw new Error('MockGfxDevice.colorTexture: target is multisample')
    return c
  }

  // --- shadow maps ----------------------------------------------------------

  createShadowArray(
    size: number,
    layers: number,
    _compare?: CompareFn,
  ): ShadowArray {
    const s = { __gfxShadowArray: undefined as never, size, layers }
    this.shadowArrays.push(s)
    return s
  }
  createShadowCube(size: number, _compare?: CompareFn): ShadowCube {
    const s = { __gfxShadowCube: undefined as never, size }
    this.shadowCubes.push(s)
    return s
  }
  deleteShadowArray(_s: ShadowArray): void {
    /* noop */
  }
  deleteShadowCube(_s: ShadowCube): void {
    /* noop */
  }

  // --- frame lifecycle & passes ---------------------------------------------

  beginFrame(): void {
    this.deviceStats.pipelineSwitches = 0
    this.deviceStats.bindGroupSwitches = 0
    this.deviceStats.textureBinds = 0
  }
  beginRenderPass(desc: RenderPassDesc): void {
    this.#curPass = { desc, drawCount: 0 }
    this.passes.push(this.#curPass)
    const dt = desc.depth?.target
    if (dt && 'shadowArray' in dt) {
      this.shadowLayerBegins.push(dt.layer)
      this.#curPassShadow = true
    } else if (dt && 'shadowCube' in dt) {
      this.shadowCubeFaceBegins.push(dt.face)
      this.#curPassShadow = true
    } else {
      this.#curPassShadow = false
    }
  }
  endRenderPass(): void {
    if (this.#curPassShadow) {
      this.shadowPassEnds++
      this.#curPassShadow = false
    }
    this.#curPass = null
  }
  endFrame(): void {
    /* noop */
  }

  // --- draw -----------------------------------------------------------------

  draw(call: DrawCall): void {
    if (this.#curPipeline !== call.pipeline) {
      this.#curPipeline = call.pipeline as MockPipeline
      this.deviceStats.pipelineSwitches++
    }
    const lastVb = call.vertexBuffers[call.vertexBuffers.length - 1]
    const snapshot = lastVb
      ? (this.#bufferBytes.get(lastVb.buffer) ??
        this.#lastBufferBytes ??
        undefined)
      : undefined
    const pipeline = call.pipeline as MockPipeline
    const desc = pipeline.desc
    this.cull = desc.cull
    this.depthTest = desc.depth?.test ?? false
    this.depthWrite = desc.depth?.write ?? true
    const kind: DrawRecord['kind'] = call.indexBuffer
      ? 'elements'
      : desc.primitive === 'line-list'
        ? 'lines'
        : call.vertexBuffers.length > 1
          ? 'instancedRange'
          : 'arrays'
    // First texture bound anywhere in the draw's bind groups.
    let texture: Texture | null = null
    for (const dg of call.bindGroups) {
      for (const e of (dg.bindGroup as MockBindGroup).entries) {
        if ('texture' in e.resource) {
          texture = e.resource.texture
          break
        }
      }
      if (texture) break
    }
    this.draws.push({
      pipeline,
      vertexBuffers: call.vertexBuffers.map((v) => ({
        buffer: v.buffer,
        offset: v.offset,
      })),
      bindGroups: call.bindGroups,
      indexBuffer: call.indexBuffer,
      vertexCount: call.vertexCount,
      indexCount: call.indexCount,
      first: call.first ?? 0,
      instanceCount: call.instanceCount ?? 1,
      bufferSnapshot: snapshot,
      kind,
      count: call.indexCount ?? call.vertexCount ?? 0,
      program: desc.shader ?? null,
      blend: desc.color?.blend ?? 'none',
      texture,
    })
    if (this.#curPass) this.#curPass.drawCount++
  }

  /** Alias for {@link shaders} — tests refer to created programs. */
  get programs(): ShaderModule[] {
    return this.shaders
  }

  // --- present --------------------------------------------------------------

  present(
    source: RenderTarget,
    dstWidth: number,
    dstHeight: number,
    _o?: BlitOpts,
  ): void {
    this.presents.push({ source, dstWidth, dstHeight })
  }

  // --- context loss ---------------------------------------------------------

  isContextLost(): boolean {
    return false
  }
  onContextLost(cb: () => void): () => void {
    this.#lostCbs.add(cb)
    return () => this.#lostCbs.delete(cb)
  }
  onContextRestored(cb: () => void): () => void {
    this.#restoredCbs.add(cb)
    return () => this.#restoredCbs.delete(cb)
  }
  destroy(): void {
    this.#lostCbs.clear()
    this.#restoredCbs.clear()
  }

  // --- test-only helpers ----------------------------------------------------

  simulateContextLost(): void {
    for (const cb of this.#lostCbs) cb()
  }
  simulateContextRestored(): void {
    for (const cb of this.#restoredCbs) cb()
  }

  reset(): void {
    this.draws.length = 0
    this.passes.length = 0
    this.uploads.length = 0
    this.uniformUploads.length = 0
    this.indexUploads.length = 0
    this.subImageUploads.length = 0
    this.boundTargets.length = 0
    this.presents.length = 0
    this.deletedRenderTargets = 0
    this.shadowLayerBegins.length = 0
    this.shadowCubeFaceBegins.length = 0
    this.shadowPassEnds = 0
    this.cull = 'none'
    this.depthTest = false
    this.depthWrite = true
    this.#curPassShadow = false
    this.#bufferBytes.clear()
    this.#lastBufferBytes = null
    this.#curPipeline = null
    this.#curPass = null
    this.deviceStats.pipelineSwitches = 0
    this.deviceStats.bindGroupSwitches = 0
    this.deviceStats.textureBinds = 0
  }
}
