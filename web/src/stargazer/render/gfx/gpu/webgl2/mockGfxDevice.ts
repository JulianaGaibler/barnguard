import type {
  AttribBinding,
  BeginFrameOpts,
  BlitOpts,
  GfxBlendMode,
  GfxDevice,
  Program,
  ProgramOpts,
  RenderTarget,
  RenderTargetOpts,
  Texture,
  Texture2DOpts,
  TextureUploadOpts,
  VBuffer,
  Vao,
} from '../../GfxDevice'

export interface DrawRecord {
  kind: 'arrays' | 'instanced'
  first: number
  count: number
  instanceCount?: number
  /** Program identity at the time of the draw, for asserting program switches. */
  program: Program | null
  /** Blend mode at the time of the draw, for asserting blend switches. */
  blend: GfxBlendMode
  /** Sampler texture bound (last-set) at time of draw, if any. */
  texture: Texture | null
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

  #curProgram: Program | null = null
  #curBlend: GfxBlendMode = 'source-over'
  #curTexture: Texture | null = null
  #lastBufferBytes: ArrayBuffer | null = null
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
    this.#curProgram = p
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
  setUniformTexture(_p: Program, _n: string, t: Texture, _u: number): void {
    this.#curTexture = t
  }

  createVertexBuffer(_byteSize: number): VBuffer {
    const b = { __gfxBuffer: undefined as never }
    this.buffers.push(b)
    return b
  }
  updateBufferSubData(
    _buf: VBuffer,
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
    void bpe
  }
  deleteBuffer(_b: VBuffer): void {
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
  deleteTexture(_t: Texture): void {
    /* noop */
  }

  createVao(_p: Program, _attribs: AttribBinding[]): Vao {
    const v = { __gfxVao: undefined as never }
    this.vaos.push(v)
    return v
  }
  bindVao(_v: Vao): void {
    /* noop */
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
    }
    this.renderTargets.push(rt)
    return rt
  }
  resizeRenderTarget(_rt: RenderTarget, _w: number, _h: number): void {
    /* noop */
  }
  deleteRenderTarget(_rt: RenderTarget): void {
    /* noop */
  }

  beginFrame(_opts: BeginFrameOpts): void {
    /* noop */
  }
  endFrame(): void {
    /* noop */
  }

  setBlend(mode: GfxBlendMode): void {
    this.#curBlend = mode
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

  blitToDefault(_s: RenderTarget, _w: number, _h: number, _o?: BlitOpts): void {
    /* noop */
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

  reset(): void {
    this.draws.length = 0
    this.subImageUploads.length = 0
    this.capturedUniforms.clear()
  }
}
