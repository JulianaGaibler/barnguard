import type {
  AttribBinding,
  BeginFrameOpts,
  BlitOpts,
  CullMode,
  DeviceStats,
  GfxBlendMode,
  GfxDevice,
  IBuffer,
  IndexType,
  Program,
  ProgramOpts,
  RenderTarget,
  RenderTargetOpts,
  ShadowArray,
  ShadowCube,
  Texture,
  Texture2DOpts,
  TextureUploadOpts,
  UBuffer,
  VBuffer,
  Vao,
} from '../GfxDevice'

export interface DrawRecord {
  kind: 'arrays' | 'lines' | 'instanced' | 'instancedRange' | 'elements'
  first: number
  count: number
  instanceCount?: number
  /**
   * For `instancedRange`: the re-point base byte offset into the instance
   * buffer.
   */
  baseByteOffset?: number
  /** For `elements`: the index-buffer byte offset. */
  byteOffset?: number
  /** Program identity at the time of the draw, for asserting program switches. */
  program: Program | null
  /** Blend mode at the time of the draw, for asserting blend switches. */
  blend: GfxBlendMode
  /** Sampler texture bound (last-set) at time of draw, if any. */
  texture: Texture | null
  /** For `elements`: the VAO bound at draw time (identifies retained geometry). */
  vao?: Vao | null
  /**
   * A copy of the most recent buffer upload made to whichever VBO this program
   * was reading from. Populated by `updateBufferSubData` and captured at draw
   * time so tests can inspect vertex/instance data.
   */
  bufferSnapshot?: ArrayBuffer
}

/**
 * Test-only `GfxDevice` that records draw calls into an in-memory list. All
 * other operations are cheap stubs that hand back plausibly-shaped handles so
 * `GpuGfx` can run its create/upload/draw flow unchanged. Handle equality is by
 * identity, you can compare handles across calls.
 */
export class MockGfxDevice implements GfxDevice {
  readonly draws: DrawRecord[] = []
  readonly programs: Program[] = []
  readonly buffers: VBuffer[] = []
  readonly textures: Texture[] = []
  readonly vaos: Vao[] = []
  readonly renderTargets: RenderTarget[] = []
  /** Every `resolveTo(src → dst)` FBO→FBO resolve, in order. */
  readonly resolves: { src: RenderTarget; dst: RenderTarget }[] = []
  /** Every `bindRenderTarget` target, in order (post-fx ping-pong binds). */
  readonly boundTargets: RenderTarget[] = []
  /** Every `blitToDefault` present, in order. */
  readonly blits: {
    source: RenderTarget
    dstWidth: number
    dstHeight: number
  }[] = []
  /** Count of `deleteRenderTarget` calls (pool realloc / teardown). */
  deletedRenderTargets = 0

  #curProgram: Program | null = null
  #curBlend: GfxBlendMode = 'source-over'
  #curTexture: Texture | null = null
  /** Texture bound per unit, mirrors the real device's elision for stats. */
  #boundTex: (Texture | null)[] = []
  #lastBufferBytes: ArrayBuffer | null = null

  /**
   * Real-GL-change counters, mirrored from the WebGL2 device (see
   * `DeviceStats`).
   */
  readonly deviceStats: DeviceStats = {
    programSwitches: 0,
    blendSwitches: 0,
    textureBinds: 0,
  }
  // Per-buffer copy of the most recent upload. Under record/submit every stream
  // uploads before any draw replays, so `#lastBufferBytes` alone would attach
  // the last-uploaded stream to every draw. `drawInstancedRange` gets its
  // buffer handle, so it looks the right copy up here.
  #bufferBytes = new Map<VBuffer, ArrayBuffer>()
  #lostCbs = new Set<() => void>()
  #restoredCbs = new Set<() => void>()

  createProgram(_opts: ProgramOpts): Program {
    const p = { __gfxProgram: undefined as never }
    this.programs.push(p)
    return p
  }
  deleteProgram(_p: Program): void {
    /* noop */
  }
  useProgram(p: Program): void {
    if (this.#curProgram === p) return
    this.#curProgram = p
    this.deviceStats.programSwitches++
  }
  /** Test-visible uniform log (last-write-wins per (program, name)). */
  capturedUniforms = new Map<Program, Map<string, Float32Array | number>>()
  #recordUniform(p: Program, name: string, value: Float32Array | number): void {
    let byName = this.capturedUniforms.get(p)
    if (!byName) {
      byName = new Map()
      this.capturedUniforms.set(p, byName)
    }
    // For mat3s we copy so the caller's mutations don't leak in.
    byName.set(
      name,
      value instanceof Float32Array ? new Float32Array(value) : value,
    )
  }
  setUniform1i(p: Program, n: string, v: number): void {
    this.#recordUniform(p, n, v)
  }
  setUniform1f(p: Program, n: string, v: number): void {
    this.#recordUniform(p, n, v)
  }
  setUniform2f(p: Program, n: string, x: number, y: number): void {
    this.#recordUniform(p, n, new Float32Array([x, y]))
  }
  setUniform4f(
    p: Program,
    n: string,
    x: number,
    y: number,
    z: number,
    w: number,
  ): void {
    this.#recordUniform(p, n, new Float32Array([x, y, z, w]))
  }
  setUniformMat3(p: Program, n: string, m: Float32Array): void {
    this.#recordUniform(p, n, m)
  }
  setUniformMat4(p: Program, n: string, m: Float32Array): void {
    this.#recordUniform(p, n, m)
  }
  setUniformTexture(_p: Program, _n: string, t: Texture, unit: number): void {
    if (this.#boundTex[unit] !== t) {
      this.#boundTex[unit] = t
      this.deviceStats.textureBinds++
    }
    this.#curTexture = t
  }

  // --- shadow maps (test-visible records) -----------------------------------
  readonly shadowArrays: ShadowArray[] = []
  readonly shadowCubes: ShadowCube[] = []
  /** Layers begun this session (assert a caster rendered into layer 0, etc.). */
  readonly shadowLayerBegins: number[] = []
  /** Cube faces begun (assert 6 per point caster). */
  readonly shadowCubeFaceBegins: number[] = []
  shadowPassEnds = 0

  createShadowArray(size: number, layers: number): ShadowArray {
    const s = { __gfxShadowArray: undefined as never, size, layers }
    this.shadowArrays.push(s)
    return s
  }
  createShadowCube(size: number): ShadowCube {
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
  beginShadowLayer(_s: ShadowArray, layer: number): void {
    this.shadowLayerBegins.push(layer)
  }
  beginShadowCubeFace(_s: ShadowCube, face: number): void {
    this.shadowCubeFaceBegins.push(face)
  }
  endShadowPass(): void {
    this.shadowPassEnds++
  }
  setUniformShadowArray(
    p: Program,
    n: string,
    _s: ShadowArray,
    unit: number,
  ): void {
    this.#recordUniform(p, n, unit)
  }
  setUniformShadowCube(
    p: Program,
    n: string,
    _s: ShadowCube,
    unit: number,
  ): void {
    this.#recordUniform(p, n, unit)
  }
  setUniformMat4Array(p: Program, n: string, m: Float32Array): void {
    this.#recordUniform(p, n, m)
  }

  createVertexBuffer(_byteSize: number): VBuffer {
    const b = { __gfxBuffer: undefined as never }
    this.buffers.push(b)
    return b
  }
  /** Test-visible log of every buffer upload (assert "one upload per stream"). */
  readonly uploads: Array<{ buffer: VBuffer; byteLength: number }> = []
  updateBufferSubData(
    buf: VBuffer,
    _byteOffset: number,
    src: ArrayBufferView,
    srcOffsetBytes = 0,
    byteLength?: number,
  ): void {
    // Snapshot the uploaded range so subsequent draw calls can attach it to
    // their `DrawRecord` for inspection (tests: dashStart continuity, etc.).
    const bpe = (src as { BYTES_PER_ELEMENT?: number }).BYTES_PER_ELEMENT ?? 1
    const len = byteLength ?? src.byteLength - srcOffsetBytes
    const start = src.byteOffset + srcOffsetBytes
    // Slice the underlying buffer for a stable copy. Cast away
    // `SharedArrayBuffer` since we only ever hand in normal ArrayBuffers
    // (dual-view Float32/Uint32 backed by `new ArrayBuffer(...)`).
    this.#lastBufferBytes = (src.buffer as ArrayBuffer).slice(
      start,
      start + len,
    )
    this.#bufferBytes.set(buf, this.#lastBufferBytes)
    this.uploads.push({ buffer: buf, byteLength: len })
    void bpe
  }
  deleteBuffer(_b: VBuffer): void {
    /* noop */
  }
  orphanBuffer(_b: VBuffer): void {
    /* noop */
  }

  /** Uniform buffers created (assert one projection UBO built once). */
  readonly uniformBuffers: UBuffer[] = []
  /** Test-visible log of uniform-buffer uploads (assert one `u_proj`/frame). */
  readonly uniformUploads: Array<{ buffer: UBuffer; data: Float32Array }> = []
  createUniformBuffer(_byteSize: number): UBuffer {
    const b = { __gfxUniformBuffer: undefined as never }
    this.uniformBuffers.push(b)
    return b
  }
  updateUniformBuffer(buffer: UBuffer, data: Float32Array): void {
    this.uniformUploads.push({ buffer, data: new Float32Array(data) })
  }
  bindUniformBufferBase(_buffer: UBuffer, _index: number): void {
    /* noop */
  }
  deleteUniformBuffer(_b: UBuffer): void {
    /* noop */
  }

  /** Index buffers created (assert retained geometry uploads once). */
  readonly indexBuffers: IBuffer[] = []
  /** Test-visible log of index-buffer uploads. */
  readonly indexUploads: Array<{ buffer: IBuffer; byteLength: number }> = []
  /** Test-visible index widths, parallel to `indexBuffers`. */
  readonly indexBufferTypes: IndexType[] = []
  createIndexBuffer(_byteSize: number, type: IndexType = 'u16'): IBuffer {
    const b = { __gfxIndexBuffer: undefined as never }
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
  /** Test-visible counter, how many times a sub-image upload happened. */
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
  deleteTexture(t: Texture): void {
    for (let u = 0; u < this.#boundTex.length; u++) {
      if (this.#boundTex[u] === t) this.#boundTex[u] = null
    }
  }

  #curVao: Vao | null = null
  createVao(
    _p: Program,
    _attribs: AttribBinding[],
    _indexBuffer?: IBuffer,
  ): Vao {
    const v = { __gfxVao: undefined as never }
    this.vaos.push(v)
    return v
  }
  bindVao(v: Vao): void {
    this.#curVao = v
  }
  deleteVao(_v: Vao): void {
    /* noop */
  }

  createRenderTarget(opts: RenderTargetOpts): RenderTarget {
    // Mock reports the requested sample count unclamped, real devices
    // clamp to `MAX_SAMPLES`; the mock has no such cap so tests can
    // assert what was asked for.
    const samples = Math.max(1, Math.floor(opts.samples ?? 1))
    const rt = {
      __gfxRenderTarget: undefined as never,
      width: opts.width,
      height: opts.height,
      samples,
      // Test-visible: whether a depth-stencil attachment was requested.
      hasDepth: opts.depth === true,
      // Test-visible: requested color space (`'srgb'` for a sampled 2D-in-3D
      // target, else `'linear'`).
      colorSpace: opts.colorSpace ?? 'linear',
      // Single-sample targets expose a sampleable color texture, mirroring the
      // real device, so `GpuGfx.colorTexture` resolves in tests.
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
  bindRenderTarget(target: RenderTarget): void {
    this.boundTargets.push(target)
  }
  resolveTo(src: RenderTarget, dst: RenderTarget): void {
    this.resolves.push({ src, dst })
  }

  beginFrame(_opts: BeginFrameOpts): void {
    // Match the real device: reset the per-frame counters; the binding caches
    // persist across frames.
    this.deviceStats.programSwitches = 0
    this.deviceStats.blendSwitches = 0
    this.deviceStats.textureBinds = 0
  }
  endFrame(): void {
    /* noop */
  }

  setBlend(mode: GfxBlendMode): void {
    if (this.#curBlend === mode) return
    this.#curBlend = mode
    this.deviceStats.blendSwitches++
  }

  /** Test-visible 3D render state, mirroring the real device's cache. */
  depthTest = false
  depthWrite = true
  cull: CullMode = 'none'
  /** Count of `resetToBaseline` calls, for asserting the pass boundary. */
  resetToBaselineCount = 0
  setDepthTest(enabled: boolean): void {
    this.depthTest = enabled
  }
  setDepthWrite(enabled: boolean): void {
    this.depthWrite = enabled
  }
  setCullFace(mode: CullMode): void {
    this.cull = mode
  }
  resetToBaseline(): void {
    this.resetToBaselineCount++
    this.setDepthTest(false)
    this.setDepthWrite(true)
    this.setCullFace('none')
    this.setBlend('source-over')
  }

  drawArrays(first: number, count: number): void {
    this.draws.push({
      kind: 'arrays',
      first,
      count,
      program: this.#curProgram,
      blend: this.#curBlend,
      texture: this.#curTexture,
      bufferSnapshot: this.#lastBufferBytes ?? undefined,
    })
  }
  drawLines(first: number, count: number): void {
    this.draws.push({
      kind: 'lines',
      first,
      count,
      program: this.#curProgram,
      blend: this.#curBlend,
      texture: this.#curTexture,
      bufferSnapshot: this.#lastBufferBytes ?? undefined,
    })
  }
  drawArraysInstanced(
    first: number,
    count: number,
    instanceCount: number,
  ): void {
    this.draws.push({
      kind: 'instanced',
      first,
      count,
      instanceCount,
      program: this.#curProgram,
      blend: this.#curBlend,
      texture: this.#curTexture,
      bufferSnapshot: this.#lastBufferBytes ?? undefined,
    })
  }
  drawInstancedRange(
    _vao: Vao,
    instanceBuffer: VBuffer,
    _instanceAttribs: readonly AttribBinding[],
    baseByteOffset: number,
    vertCount: number,
    instanceCount: number,
  ): void {
    this.draws.push({
      kind: 'instancedRange',
      first: 0,
      count: vertCount,
      instanceCount,
      baseByteOffset,
      program: this.#curProgram,
      blend: this.#curBlend,
      texture: this.#curTexture,
      bufferSnapshot:
        this.#bufferBytes.get(instanceBuffer) ??
        this.#lastBufferBytes ??
        undefined,
    })
  }
  drawElements(count: number, byteOffset: number): void {
    this.draws.push({
      kind: 'elements',
      first: 0,
      count,
      byteOffset,
      program: this.#curProgram,
      blend: this.#curBlend,
      texture: this.#curTexture,
      // The bound VAO identifies which retained geometry drew.
      vao: this.#curVao,
    })
  }

  blitToDefault(
    source: RenderTarget,
    dstWidth: number,
    dstHeight: number,
    _o?: BlitOpts,
  ): void {
    this.blits.push({ source, dstWidth, dstHeight })
  }

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

  // Test-only helpers ---------------------------------------------------------

  /** Fire the registered `onContextLost` callbacks. */
  simulateContextLost(): void {
    for (const cb of this.#lostCbs) cb()
  }
  /** Fire the registered `onContextRestored` callbacks. */
  simulateContextRestored(): void {
    for (const cb of this.#restoredCbs) cb()
  }

  reset(): void {
    this.draws.length = 0
    this.uploads.length = 0
    this.uniformUploads.length = 0
    this.indexUploads.length = 0
    this.subImageUploads.length = 0
    this.resolves.length = 0
    this.boundTargets.length = 0
    this.blits.length = 0
    this.deletedRenderTargets = 0
    this.capturedUniforms.clear()
    this.#bufferBytes.clear()
    this.#lastBufferBytes = null
    this.#curProgram = null
    this.#curBlend = 'source-over'
    this.#curTexture = null
    this.#boundTex = []
    this.#curVao = null
    this.depthTest = false
    this.depthWrite = true
    this.cull = 'none'
    this.resetToBaselineCount = 0
    // Note: index/uniform buffer lists persist across reset() — they're created
    // once at backend init, before the first frame's reset.
    this.deviceStats.programSwitches = 0
    this.deviceStats.blendSwitches = 0
    this.deviceStats.textureBinds = 0
  }
}
