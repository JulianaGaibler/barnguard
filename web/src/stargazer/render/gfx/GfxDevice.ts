/**
 * `GfxDevice`, backend seam. Thin and imperative: allocate handles, upload
 * data, set state, draw. Handle types are branded opaque markers (not classes)
 * so a WebGPU backend can return `GPURenderPipeline` / `GPUBuffer` / etc.
 * through the same seam without instanceof checks. Typed uniform setters keep
 * the caller side clean.
 */

// --- opaque handle types ----------------------------------------------------

// A `Program` is a linked shader program. Backends interpret it however they
// like; callers only pass it through.
export interface Program {
  readonly __gfxProgram: unique symbol
}

/**
 * GPU-side vertex/instance data buffer (`GL_ARRAY_BUFFER` on WebGL2). The
 * device doesn't currently ship an index-buffer type.
 */
export interface VBuffer {
  readonly __gfxBuffer: unique symbol
}

export interface Texture {
  readonly __gfxTexture: unique symbol
  readonly width: number
  readonly height: number
}

export interface Vao {
  readonly __gfxVao: unique symbol
}

/**
 * GPU-side uniform block buffer (`GL_UNIFORM_BUFFER` on WebGL2), bound to a
 * binding index that every program sharing the block reads from.
 */
export interface UBuffer {
  readonly __gfxUniformBuffer: unique symbol
}

/**
 * GPU-side index buffer (`GL_ELEMENT_ARRAY_BUFFER` on WebGL2). Indices are
 * `UNSIGNED_SHORT` — retained geometry asserts ≤ 65 535 vertices per handle.
 * The element-array binding is VAO state, so an index buffer is associated with
 * a VAO at `createVao` time, not per draw.
 */
export interface IBuffer {
  readonly __gfxIndexBuffer: unique symbol
}

export interface RenderTarget {
  readonly __gfxRenderTarget: unique symbol
  readonly width: number
  readonly height: number
  /**
   * Effective (post-clamp) MSAA sample count. `1` under Canvas mode or when
   * MSAA is disabled; `>1` when a multisample color attachment was allocated.
   * Backends clamp the requested value down to `MAX_SAMPLES`, so this is what's
   * actually running, not what was asked for. Read by the HUD to confirm MSAA
   * is active.
   */
  readonly samples: number
}

// --- attribute layout descriptors ------------------------------------------

/**
 * A single vertex/instance attribute pointer. The `location` corresponds to the
 * shader's `layout(location = N)`, for WebGL2 without explicit layout
 * qualifiers, the device forces it via `bindAttribLocation` before link.
 */
export interface AttribBinding {
  buffer: VBuffer
  location: number
  size: 1 | 2 | 3 | 4
  type: AttribType
  normalized: boolean
  offset: number
  stride: number
  /** 0 = per-vertex, 1 = per-instance. */
  divisor: number
}

export type AttribType = 'float' | 'unorm8' | 'uint8'

// --- creation opts ---------------------------------------------------------

export interface ProgramOpts {
  vertexSrc: string
  fragmentSrc: string
  /**
   * Map attribute name → attribute location. The device binds these before
   * linking so `AttribBinding.location` values passed to `createVao` line up
   * with the shader's `in` variables regardless of driver assignment.
   */
  attribs: Record<string, number>
  /**
   * Map uniform-block name → binding index. After link the device points each
   * named `layout(std140) uniform <name> {...}` block at the given binding, so
   * a UBO bound there with `bindUniformBufferBase` feeds every program that
   * shares the block (e.g. the per-frame projection).
   */
  uniformBlocks?: Record<string, number>
}

export interface Texture2DOpts {
  width: number
  height: number
  filter?: 'nearest' | 'linear'
  wrap?: 'clamp' | 'repeat'
}

export interface TextureUploadOpts {
  flipY?: boolean
  premultiply?: boolean
}

export interface RenderTargetOpts {
  width: number
  height: number
  /**
   * MSAA sample count. Default `1` (no MSAA, a plain color texture attachment).
   * Values `> 1` allocate a multisample color renderbuffer; the render target
   * then **cannot be sampled as a texture** (no multisample texture attachments
   * in WebGL2 core). Callers that need to read the render target as a texture
   * must add an explicit resolve pass (blit to a single-sample texture).
   * Backends clamp to the driver's `MAX_SAMPLES`.
   */
  samples?: number
  /**
   * Attach a depth-stencil buffer (`DEPTH24_STENCIL8`, sample count matched to
   * the color attachment). Default `false` — the 2D renderer is painter-ordered
   * and needs no depth. A future 3D pass opts in. (The default framebuffer's
   * own `depth:false` at `getContext` is unrelated; this concerns FBO
   * attachments.)
   */
  depth?: boolean
}

export interface BeginFrameOpts {
  target: RenderTarget
  /** RGBA in `0..1`. Clears the target at frame start. */
  clearColor?: readonly [number, number, number, number]
}

export interface BlitOpts {
  filter?: 'nearest' | 'linear'
}

// --- state -----------------------------------------------------------------

export type GfxBlendMode = 'source-over' | 'lighter'

/**
 * Per-frame counts of _real_ GL state changes — incremented by the device only
 * after its redundant-call elision, so the HUD reflects driver work actually
 * done rather than calls issued. Reset in `beginFrame`; read after `endFrame`.
 */
export interface DeviceStats {
  programSwitches: number
  blendSwitches: number
  textureBinds: number
}

// --- device interface ------------------------------------------------------

export interface GfxDevice {
  /** Live counters of real GL state changes this frame (reset in `beginFrame`). */
  readonly deviceStats: DeviceStats

  // Programs -----------------------------------------------------------------
  createProgram(opts: ProgramOpts): Program
  deleteProgram(p: Program): void
  useProgram(p: Program): void

  // Uniforms -----------------------------------------------------------------
  setUniform1i(p: Program, name: string, v: number): void
  setUniform1f(p: Program, name: string, v: number): void
  setUniform4f(
    p: Program,
    name: string,
    x: number,
    y: number,
    z: number,
    w: number,
  ): void
  setUniformMat3(p: Program, name: string, m: Float32Array): void
  /**
   * Bind `tex` to the given texture unit and set the sampler uniform to that
   * unit. Idempotent state hygiene, never relies on the default `TEXTURE0`.
   */
  setUniformTexture(p: Program, name: string, tex: Texture, unit: number): void

  // Buffers ------------------------------------------------------------------
  createVertexBuffer(byteSize: number): VBuffer
  /**
   * Write `src` into `buf` at `byteOffset`. `srcOffset` and `byteLength` slice
   * the source view; defaults cover the whole `src`.
   */
  updateBufferSubData(
    buf: VBuffer,
    byteOffset: number,
    src: ArrayBufferView,
    srcOffsetBytes?: number,
    byteLength?: number,
  ): void
  deleteBuffer(buf: VBuffer): void
  /**
   * Reallocate `buf`'s storage at its current byte size (`bufferData` with a
   * null/size argument), detaching whatever the GPU is still reading. Used
   * after a mid-frame overflow submit so the append cursor can restart at 0
   * without overwriting data an in-flight draw call still references.
   */
  orphanBuffer(buf: VBuffer): void

  // Uniform buffers ----------------------------------------------------------
  /** Allocate a uniform-block buffer of `byteSize` (std140-laid-out by callers). */
  createUniformBuffer(byteSize: number): UBuffer
  /** Overwrite `buf` from offset 0 with `data`. */
  updateUniformBuffer(buf: UBuffer, data: Float32Array): void
  /**
   * Bind `buf` to the given binding index, so every program whose matching
   * uniform block was pointed there (via `ProgramOpts.uniformBlocks`) reads
   * it.
   */
  bindUniformBufferBase(buf: UBuffer, index: number): void
  deleteUniformBuffer(buf: UBuffer): void

  // Index buffers ------------------------------------------------------------
  /** Allocate an index buffer of `byteSize` (`UNSIGNED_SHORT` indices). */
  createIndexBuffer(byteSize: number): IBuffer
  /** Write `src` (a `Uint16Array`) into `buf` at `byteOffset`. */
  updateIndexBufferSubData(
    buf: IBuffer,
    byteOffset: number,
    src: Uint16Array,
  ): void
  deleteIndexBuffer(buf: IBuffer): void

  // Textures -----------------------------------------------------------------
  createTexture2D(opts: Texture2DOpts): Texture
  /**
   * Upload `source` into a sub-region of `tex` starting at `(xOffset,
   * yOffset)`. Used by the sprite atlas to poke one 66×66 tile at a time ,
   * vastly cheaper than re-uploading the whole 1024×1024 atlas. `flipY` and
   * `premultiply` are per-call unpack flags (same shape as `updateTexture2D`).
   */
  updateTextureSubImage2D(
    tex: Texture,
    xOffset: number,
    yOffset: number,
    source: TexImageSource,
    opts?: TextureUploadOpts,
  ): void
  /**
   * Upload `source` into `tex`. `source === null` reallocates storage at the
   * texture's current size (used for FBO color attachments). `flipY` and
   * `premultiply` toggle the WebGL unpack flags for this call only.
   */
  updateTexture2D(
    tex: Texture,
    source: TexImageSource | null,
    opts?: TextureUploadOpts,
  ): void
  deleteTexture(tex: Texture): void

  // Vertex arrays ------------------------------------------------------------
  /**
   * Create a VAO capturing `attribs`. An optional `indexBuffer` is bound into
   * the VAO as its `ELEMENT_ARRAY_BUFFER` (VAO state), so a later `bindVao` +
   * `drawElements` draws indexed against it.
   */
  createVao(
    program: Program,
    attribs: AttribBinding[],
    indexBuffer?: IBuffer,
  ): Vao
  bindVao(vao: Vao): void
  deleteVao(vao: Vao): void

  // Render targets -----------------------------------------------------------
  createRenderTarget(opts: RenderTargetOpts): RenderTarget
  resizeRenderTarget(rt: RenderTarget, width: number, height: number): void
  deleteRenderTarget(rt: RenderTarget): void

  // Frame lifecycle ----------------------------------------------------------
  beginFrame(opts: BeginFrameOpts): void
  endFrame(): void

  // State --------------------------------------------------------------------
  setBlend(mode: GfxBlendMode): void

  // Draw ---------------------------------------------------------------------
  drawArrays(first: number, count: number): void
  drawArraysInstanced(first: number, count: number, instanceCount: number): void
  /**
   * Indexed draw of `count` `UNSIGNED_SHORT` indices starting at `byteOffset`
   * into the bound VAO's element buffer. `bindVao` a VAO created with an index
   * buffer first.
   */
  drawElements(count: number, byteOffset: number): void
  /**
   * Instanced draw of `instanceCount` instances starting at `baseByteOffset`
   * into `instanceBuffer`. WebGL2 has no base-instance parameter, so this
   * re-points each per-instance (divisor-1) attribute to `baseByteOffset +
   * binding.offset` before drawing — the record/submit path's way of issuing
   * one recorded run's sub-range. `vao` supplies the divisor-0 vertex attribute
   * (the shared unit quad); `instanceAttribs` must be exactly the divisor-1
   * bindings, all reading from `instanceBuffer`.
   */
  drawInstancedRange(
    vao: Vao,
    instanceBuffer: VBuffer,
    instanceAttribs: readonly AttribBinding[],
    baseByteOffset: number,
    vertCount: number,
    instanceCount: number,
  ): void

  // Present / blit -----------------------------------------------------------
  /**
   * Blit the current frame's render target to the default framebuffer (the
   * canvas). Called by GpuGfx from `endFrame`. `dstWidth`/`dstHeight` are the
   * canvas drawing-buffer size, normally equal to the FBO size.
   */
  blitToDefault(
    source: RenderTarget,
    dstWidth: number,
    dstHeight: number,
    opts?: BlitOpts,
  ): void

  // Context loss -------------------------------------------------------------
  isContextLost(): boolean
  /** Register a listener; returns an unsubscribe function. */
  onContextLost(cb: () => void): () => void
  onContextRestored(cb: () => void): () => void

  // Teardown -----------------------------------------------------------------
  destroy(): void
}
