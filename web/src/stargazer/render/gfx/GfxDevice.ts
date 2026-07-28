/**
 * `GfxDevice`, backend seam. Modelled on WebGPU semantics so a WebGPU backend
 * implements it directly and WebGL2 emulates it: a frame is a command encoder
 * holding one or more **render passes**, each pass declares its attachments and
 * their load/store/clear ops, immutable **pipelines** bundle shader + vertex
 * layout + blend/depth/cull/winding + target format, resources bind through
 * **bind groups**, and every draw states all its inputs explicitly (no ambient
 * global state). Handle types are branded opaque markers (not classes) so a
 * backend can return `GPURenderPipeline` / `GPUBuffer` / etc. through the same
 * seam without `instanceof` checks.
 *
 * The imperative WebGL-shaped surface (per-name `setUniform*`, `useProgram`,
 * `bindVao`, `setBlend`/`setDepthTest`, `drawArrays`/`drawElements`, a bare
 * `bindRenderTarget`) is gone: per-draw data rides in vertex buffers or
 * dynamic-offset uniform buffers, state lives in the pipeline, attachment
 * clears live in the pass, and a single `draw(desc)` carries the rest.
 */

import type { ClipDepth } from '../../math/Mat4'

// --- opaque handle types ----------------------------------------------------

/**
 * A compiled shader module. Carries whatever source the active backend needs
 * (GLSL for WebGL2, WGSL for WebGPU) plus reflection so the backend can wire
 * attributes/blocks/samplers without depending on generated identifier names.
 */
export interface ShaderModule {
  readonly __gfxShader: unique symbol
}

/**
 * An immutable render pipeline: a shader plus the fixed state a draw needs
 * (vertex layout, color format + blend, depth, cull, winding, primitive,
 * samples). Backends memoize on the descriptor (handle identity for
 * `shader`/`bindGroupLayouts`, structural for the scalar fields), so requesting
 * the same configuration returns the same handle. Pipelines whose
 * `bindGroupLayouts[i]` is the _same_ {@link BindGroupLayout} handle accept the
 * same bind group at group `i` — reuse layout handles, don't rebuild them.
 */
export interface Pipeline {
  readonly __gfxPipeline: unique symbol
}

/**
 * The shape of one bind group: which slots hold uniform buffers vs textures vs
 * shadow samplers, and which uniform slots are addressed with a per-draw
 * dynamic offset. A pipeline references its bind group layouts by group index;
 * a bind group created against a layout is reusable across every pipeline that
 * references that same layout handle.
 */
export interface BindGroupLayout {
  readonly __gfxBindGroupLayout: unique symbol
}

/** A concrete set of resources bound as a unit, created against a layout. */
export interface BindGroup {
  readonly __gfxBindGroup: unique symbol
}

/** GPU-side vertex/instance data buffer (`GL_ARRAY_BUFFER` on WebGL2). */
export interface VBuffer {
  readonly __gfxBuffer: unique symbol
}

export interface Texture {
  readonly __gfxTexture: unique symbol
  readonly width: number
  readonly height: number
}

/**
 * Depth comparison function for a shadow map's comparison sampler. Stored on
 * the shadow handle so the backend can build the comparison sampler correctly —
 * the choice matters under reversed-Z, so it lives in the interface rather than
 * being hardcoded in one backend. Default `'less-equal'`.
 */
export type CompareFn = 'less-equal' | 'greater-equal' | 'less' | 'greater'

/**
 * A layered depth texture for shadow maps: a `DEPTH_COMPONENT` 2D-array with a
 * comparison sampler, one layer per shadow-casting directional or spot light.
 * Render depth into a layer with a depth-only {@link RenderPassDesc} targeting
 * `{ shadowArray, layer }`, then sample it through a
 * `'texture-2d-array-shadow'` bind-group entry.
 */
export interface ShadowArray {
  readonly __gfxShadowArray: unique symbol
  readonly size: number
  readonly layers: number
}

/**
 * A depth cubemap for a point light's shadow. Render its six faces with a
 * depth-only pass targeting `{ shadowCube, face }`, then sample it through a
 * `'texture-cube-shadow'` bind-group entry.
 */
export interface ShadowCube {
  readonly __gfxShadowCube: unique symbol
  readonly size: number
}

/**
 * GPU-side uniform-block buffer (`GL_UNIFORM_BUFFER` on WebGL2). Bound through
 * a bind group; a `'uniform-buffer'` layout entry with `dynamicOffset` lets one
 * buffer feed many draws by supplying a per-draw byte offset (the
 * dynamic-offset ring used for per-object and per-run uniforms). Like the
 * vertex ring it can be {@link GfxDevice.orphanUniformBuffer}ed on a mid-frame
 * overflow.
 */
export interface UBuffer {
  readonly __gfxUniformBuffer: unique symbol
}

/**
 * GPU-side index buffer (`GL_ELEMENT_ARRAY_BUFFER` on WebGL2). `type` picks the
 * element width; retained 2D geometry uses `'u16'` (asserts ≤ 65 535 vertices),
 * large 3D meshes `'u32'`.
 */
export interface IBuffer {
  readonly __gfxIndexBuffer: unique symbol
}

export interface RenderTarget {
  readonly __gfxRenderTarget: unique symbol
  readonly width: number
  readonly height: number
  /**
   * Effective (post-clamp) MSAA sample count: `1` when MSAA is off, `>1` when a
   * multisample color attachment was allocated. A multisample target is not
   * sampleable — resolve it (a pass `resolveTarget`, or
   * {@link GfxDevice.colorTexture} on a single-sample target) before reading
   * it.
   */
  readonly samples: number
  /**
   * Color-attachment color space the target was allocated with. A post-process
   * pass reads this to allocate ping-pong / resolve targets with a matching
   * format — a multisample→single-sample resolve requires identical formats.
   */
  readonly colorSpace: ColorFormat
  /** Whether the target carries a depth attachment (opted in at creation). */
  readonly hasDepth: boolean
}

// --- shader modules ---------------------------------------------------------

/**
 * Reflection metadata pairing the backend-neutral binding numbers used in
 * {@link VertexBufferLayout} / {@link BindGroupLayoutEntry} with the concrete
 * names a backend needs. WebGL2 reads this to `bindAttribLocation`, resolve
 * `getUniformBlockIndex`, and set sampler units by name — so naga's mangled
 * GLSL identifiers never leak into calling code. WebGPU ignores it (WGSL
 * `@location`/`@group`/`@binding` are authoritative). Std140 member offsets
 * within a block stay the caller's responsibility (see `batchLayout.ts`).
 */
export interface ShaderReflection {
  /** Vertex attribute location → GLSL `in` name (for `bindAttribLocation`). */
  attributes: { location: number; glslName: string }[]
  /** Uniform-block binding → GLSL block name (for `getUniformBlockIndex`). */
  uniformBlocks: { binding: number; glslName: string }[]
  /** Sampler binding → GLSL sampler uniform name (for `getUniformLocation`). */
  samplers: { binding: number; glslName: string }[]
}

export interface ShaderModuleDesc {
  /** WebGL2 source. Present while WebGL2 is a target. */
  glsl?: { vertex: string; fragment: string }
  /** WebGPU source with entry-point names. Present once WGSL is generated. */
  wgsl?: { code: string; vertexEntry: string; fragmentEntry: string }
  reflection: ShaderReflection
  /** Debug label surfaced in backend error messages. */
  label?: string
}

// --- vertex layout ----------------------------------------------------------

/**
 * A single vertex/instance attribute. `format` fixes both the component count
 * and how the bytes are read (`unorm8x4` normalizes 4 bytes to `[0,1]` floats,
 * matching packed colors). `location` is the shader's attribute slot.
 */
export interface VertexAttribute {
  location: number
  format: VertexFormat
  /** Byte offset of this attribute within the buffer's stride. */
  offset: number
}

export type VertexFormat =
  'float32' | 'float32x2' | 'float32x3' | 'float32x4' | 'unorm8x4' | 'uint8x4'

/**
 * Layout of one vertex buffer feeding a pipeline. `stepMode: 'instance'`
 * advances per instance (divisor 1); `'vertex'` per vertex (divisor 0). A
 * pipeline takes an array of these, one per bound vertex buffer slot; a draw
 * supplies the matching buffers (with per-binding byte offsets) in the same
 * order.
 */
export interface VertexBufferLayout {
  arrayStride: number
  stepMode: 'vertex' | 'instance'
  attributes: VertexAttribute[]
}

// --- bind groups ------------------------------------------------------------

export type BindingType =
  | 'uniform-buffer'
  | 'texture-2d'
  | 'texture-2d-array-shadow'
  | 'texture-cube-shadow'

export interface BindGroupLayoutEntry {
  /** Binding number, matching the shader's `@binding` / reflection entry. */
  binding: number
  type: BindingType
  /**
   * For `'uniform-buffer'` only: the buffer is bound with a per-draw byte
   * offset (see {@link DrawBindGroup.dynamicOffsets}). Used for the per-object /
   * per-run dynamic-offset uniform ring. A dynamic entry's
   * {@link BindingResource} **must** specify `size` (the fixed slice length).
   */
  dynamicOffset?: boolean
}

/**
 * A resource bound to one slot. For a uniform buffer, `size` is the bound slice
 * length in bytes and is **required** when the layout entry is dynamic (the
 * per-draw offset selects the slice; `size` fixes its extent). `offset` binds a
 * static sub-range when the entry is not dynamic.
 */
export type BindingResource =
  | { uniformBuffer: UBuffer; offset?: number; size?: number }
  | { texture: Texture }
  | { shadowArray: ShadowArray }
  | { shadowCube: ShadowCube }

export interface BindGroupEntry {
  binding: number
  resource: BindingResource
}

// --- pipelines --------------------------------------------------------------

export type GfxBlendMode = 'source-over' | 'lighter' | 'none'

/**
 * Face-culling mode. `'none'` draws both faces (the 2D baseline); `'back'` /
 * `'front'` cull that face of triangles wound per
 * {@link PipelineDesc.frontFace}.
 */
export type CullMode = 'none' | 'back' | 'front'

/**
 * Front-face winding. Baked into the pipeline so it can differ per backend:
 * WebGPU's `[0,1]`-Z clip space and WebGL's `[-1,1]` disagree on handedness, so
 * the same geometry needs opposite winding to cull the same faces. The 2D
 * pipelines don't cull and leave this at the default.
 */
export type FrontFace = 'ccw' | 'cw'

/**
 * The backend's coordinate conventions, which 3D rendering must match. WebGL and
 * WebGPU disagree on three things, and the shared 3D code reads them here rather
 * than hardcoding one backend:
 *
 * - `clipDepth`: NDC depth range. A camera builds its projection with this so
 *   depth lands in the range the backend keeps (WebGPU clips outside `[0,1]`).
 * - `frontFace`: winding of a front face for standard geometry. WebGPU's
 *   framebuffer is top-left origin, so the same NDC triangle has opposite
 *   apparent winding from WebGL's bottom-left origin; the 3D pipelines take this
 *   so face culling keeps the same faces.
 * - `textureTopDown`: row order of a sampled render-target texture. WebGPU
 *   stores row 0 at the top, WebGL at the bottom, so a pass that samples an
 *   offscreen target (RTT / post-process / present) flips V when this is true.
 */
export interface NdcConventions {
  clipDepth: ClipDepth
  frontFace: FrontFace
  textureTopDown: boolean
}

export type PrimitiveTopology = 'triangle-list' | 'line-list'

/** Color-target format: `'linear'` → `RGBA8`, `'srgb'` → sRGB-encoded RGBA8. */
export type ColorFormat = 'linear' | 'srgb'

/** Depth-attachment state for a pipeline. */
export interface DepthState {
  test: boolean
  write: boolean
  /** Depth comparison. Default `'less-equal'`. */
  compare?: CompareFn
  /** Slope-scaled depth bias (shadow acne control). Default `0`. */
  biasSlopeScale?: number
  /** Constant depth bias. Default `0`. */
  biasConstant?: number
}

/** Color-target state for a pipeline, or `null` for a depth-only pipeline. */
export interface ColorState {
  format: ColorFormat
  blend: GfxBlendMode
}

export interface PipelineDesc {
  shader: ShaderModule
  /** One entry per vertex buffer slot the draw will bind, in order. */
  vertexLayout: VertexBufferLayout[]
  /** Bind group layouts by group index (index 0 = `@group(0)`, …). Dense. */
  bindGroupLayouts: BindGroupLayout[]
  /** Color target, or `null` for a depth-only pipeline (shadow passes). */
  color: ColorState | null
  /** Depth state, or `null` for no depth (the painter-ordered 2D pipelines). */
  depth: DepthState | null
  cull: CullMode
  frontFace: FrontFace
  primitive: PrimitiveTopology
  /** MSAA sample count of the target this renders into (`1` = no MSAA). */
  samples: number
  label?: string
}

// --- resource creation opts -------------------------------------------------

export interface Texture2DOpts {
  width: number
  height: number
  filter?: 'nearest' | 'linear'
  wrap?: 'clamp' | 'repeat'
  /**
   * Allocate sRGB storage so sampling decodes sRGB → linear in hardware. Set
   * for glTF base-color / emissive textures; leave off (default linear `RGBA8`)
   * for normal / metallic-roughness / occlusion maps.
   */
  srgb?: boolean
  /** Allocate a mip chain and select a mipmapped min-filter. Default `false`. */
  mipmap?: boolean
  /**
   * Anisotropic-filtering cap for minified mipmapped textures, clamped to the
   * driver max; ignored when unsupported or the texture is not mipmapped.
   */
  anisotropy?: number
}

export interface TextureUploadOpts {
  flipY?: boolean
  premultiply?: boolean
  /**
   * The texture is sampled with object-space UVs (e.g. a glTF mesh's own UVs),
   * not the screen-space UVs the 2D pass uses. WebGL2 ignores this. WebGPU uses
   * it to skip the render-origin V-flip it otherwise applies (so 2D screen-space
   * textures match WebGL's bottom-up sampling); a mesh's object-space UVs must
   * not be flipped, or its texture samples upside-down.
   */
  objectSpaceUV?: boolean
}

export interface RenderTargetOpts {
  width: number
  height: number
  /**
   * MSAA sample count. Default `1`. `> 1` allocates a multisample color
   * attachment that cannot be sampled as a texture; read it back through a pass
   * `resolveTarget`. Backends clamp to their max.
   */
  samples?: number
  /**
   * Attach a depth buffer. Default `false` — the 2D renderer is painter-ordered
   * and needs none; a 3D pass opts in.
   */
  depth?: boolean
  /**
   * Color-attachment format. `'linear'` (default) → `RGBA8`; `'srgb'` →
   * sRGB-encoded. Only the single-sample path honors `'srgb'`.
   */
  colorSpace?: ColorFormat
}

export type IndexType = 'u16' | 'u32'

// --- render passes & draw ---------------------------------------------------

export type LoadOp = 'clear' | 'load'
export type StoreOp = 'store' | 'discard'

/**
 * The color attachment of a render pass. `resolveTarget` (a single-sample
 * target) receives the MSAA resolve of `target` when `target.samples > 1` —
 * this replaces a standalone post-hoc resolve, matching WebGPU where resolve is
 * part of the pass that produced the samples.
 */
export interface ColorAttachment {
  target: RenderTarget
  loadOp: LoadOp
  storeOp?: StoreOp
  /**
   * Required when `loadOp === 'clear'`. Straight (non-premultiplied) RGBA in
   * `0..1`; the backend premultiplies for the premultiplied-alpha surface.
   */
  clearColor?: readonly [number, number, number, number]
  resolveTarget?: RenderTarget
}

/**
 * Where a pass writes depth: a render target's own depth attachment, one layer
 * of a shadow array, or one face of a shadow cube. The latter two make a
 * depth-only pass (no color attachment) for shadow-map generation.
 */
export type DepthTarget =
  | { renderTarget: RenderTarget }
  | { shadowArray: ShadowArray; layer: number }
  | { shadowCube: ShadowCube; face: number }

export interface DepthAttachment {
  target: DepthTarget
  loadOp: LoadOp
  storeOp?: StoreOp
  /** Clear value when `loadOp === 'clear'`. Default `1.0`. */
  clearValue?: number
}

/**
 * A render pass: its attachments and their load/store ops. Omit `color` for a
 * depth-only shadow pass; omit `depth` for a pure-2D pass. The pass sets the
 * viewport to the attachment size.
 */
export interface RenderPassDesc {
  color?: ColorAttachment
  depth?: DepthAttachment
}

export interface BlitOpts {
  filter?: 'nearest' | 'linear'
}

/** A vertex/instance buffer bound to a draw, with a byte offset into it. */
export interface VertexBinding {
  buffer: VBuffer
  /**
   * Byte offset where this buffer's data starts for the draw. Carries a
   * command-list run's instance sub-range base (there is no portable
   * base-instance, so the offset re-points the buffer instead).
   */
  offset: number
}

/**
 * One bind group attached to a draw. `dynamicOffsets` supplies a byte offset
 * for each dynamic uniform slot in the group, **in ascending binding-number
 * order of the dynamic entries** (not all entries), each a multiple of
 * {@link DeviceLimits.minUniformBufferOffsetAlignment}.
 */
export interface DrawBindGroup {
  group: number
  bindGroup: BindGroup
  dynamicOffsets?: number[]
}

/**
 * A single draw. All inputs are explicit: no ambient program/VAO/blend state.
 * Supply either `vertexCount` (array draw) or `indexBuffer` + `indexCount`
 * (indexed draw); `instanceCount > 1` draws instanced.
 */
export interface DrawCall {
  pipeline: Pipeline
  /** Vertex buffers by slot, matching the pipeline's `vertexLayout` order. */
  vertexBuffers: VertexBinding[]
  bindGroups: DrawBindGroup[]
  indexBuffer?: IBuffer
  /** Array-draw vertex count (omit when indexed). */
  vertexCount?: number
  /** Indexed-draw index count (requires `indexBuffer`). */
  indexCount?: number
  /**
   * First element: first vertex for an array draw, or first index (in elements,
   * not bytes) for an indexed draw. Default `0`.
   */
  first?: number
  /** Instances to draw. Default `1`. */
  instanceCount?: number
}

// --- stats & limits ---------------------------------------------------------

/**
 * Per-frame counts of real GPU state changes — incremented after the backend's
 * redundant-call elision, so the HUD reflects work actually done. Reset in
 * `beginFrame`.
 */
export interface DeviceStats {
  pipelineSwitches: number
  bindGroupSwitches: number
  textureBinds: number
}

export interface DeviceLimits {
  /**
   * Required byte alignment for dynamic uniform-buffer offsets
   * (`UNIFORM_BUFFER_OFFSET_ALIGNMENT`, commonly 256). The dynamic-offset ring
   * pads each slice up to this.
   */
  minUniformBufferOffsetAlignment: number
}

// --- device interface -------------------------------------------------------

export interface GfxDevice {
  readonly deviceStats: DeviceStats
  readonly limits: DeviceLimits
  /** The backend's coordinate conventions (clip-depth, winding, texture rows). */
  readonly ndc: NdcConventions

  // Shaders / pipelines / bind groups ---------------------------------------
  createShaderModule(desc: ShaderModuleDesc): ShaderModule
  deleteShaderModule(s: ShaderModule): void
  /**
   * Create (or return a memoized) pipeline for `desc`. Async because WebGPU
   * compiles pipelines asynchronously; WebGL2 resolves immediately. Pipelines
   * are pre-warmed at init/rebuild (never created inside the frame loop, which
   * is synchronous). Identical descriptors return the same handle.
   */
  createPipeline(desc: PipelineDesc): Promise<Pipeline>
  createBindGroupLayout(entries: BindGroupLayoutEntry[]): BindGroupLayout
  createBindGroup(layout: BindGroupLayout, entries: BindGroupEntry[]): BindGroup
  deleteBindGroup(g: BindGroup): void

  // Vertex buffers ----------------------------------------------------------
  createVertexBuffer(byteSize: number): VBuffer
  updateBufferSubData(
    buf: VBuffer,
    byteOffset: number,
    src: ArrayBufferView,
    srcOffsetBytes?: number,
    byteLength?: number,
  ): void
  deleteBuffer(buf: VBuffer): void
  /**
   * Reallocate `buf`'s storage at its current size, detaching whatever the GPU
   * is still reading. Used after a mid-frame overflow submit so the append
   * cursor can restart without overwriting data an in-flight draw references.
   */
  orphanBuffer(buf: VBuffer): void

  // Uniform buffers ---------------------------------------------------------
  createUniformBuffer(byteSize: number): UBuffer
  /** Write `data` into `buf` at `byteOffset` (default 0). */
  updateUniformBuffer(
    buf: UBuffer,
    data: ArrayBufferView,
    byteOffset?: number,
  ): void
  /**
   * Reallocate a uniform buffer's storage — the UBO-ring analogue of
   * {@link orphanBuffer}.
   */
  orphanUniformBuffer(buf: UBuffer): void
  deleteUniformBuffer(buf: UBuffer): void

  // Index buffers -----------------------------------------------------------
  createIndexBuffer(byteSize: number, type?: IndexType): IBuffer
  updateIndexBufferSubData(
    buf: IBuffer,
    byteOffset: number,
    src: Uint16Array | Uint32Array,
  ): void
  deleteIndexBuffer(buf: IBuffer): void

  // Textures ----------------------------------------------------------------
  createTexture2D(opts: Texture2DOpts): Texture
  updateTextureSubImage2D(
    tex: Texture,
    xOffset: number,
    yOffset: number,
    source: TexImageSource,
    opts?: TextureUploadOpts,
  ): void
  /** `source === null` reallocates storage at the texture's current size. */
  updateTexture2D(
    tex: Texture,
    source: TexImageSource | null,
    opts?: TextureUploadOpts,
  ): void
  deleteTexture(tex: Texture): void

  // Render targets ----------------------------------------------------------
  createRenderTarget(opts: RenderTargetOpts): RenderTarget
  resizeRenderTarget(rt: RenderTarget, width: number, height: number): void
  deleteRenderTarget(rt: RenderTarget): void
  /**
   * The sampleable color texture backing a single-sample render target (for a
   * post-process pass or a `Viewport2DNode` quad). Throws for a multisample
   * target — resolve it via a pass `resolveTarget` first.
   */
  colorTexture(rt: RenderTarget): Texture

  // Shadow maps -------------------------------------------------------------
  createShadowArray(
    size: number,
    layers: number,
    compare?: CompareFn,
  ): ShadowArray
  createShadowCube(size: number, compare?: CompareFn): ShadowCube
  deleteShadowArray(s: ShadowArray): void
  deleteShadowCube(s: ShadowCube): void

  // Frame lifecycle & passes ------------------------------------------------
  /** Start a frame: reset per-frame stats; open the command encoder (WebGPU). */
  beginFrame(): void
  /** Open a render pass with the given attachments and load/store ops. */
  beginRenderPass(desc: RenderPassDesc): void
  /** Close the current render pass. */
  endRenderPass(): void
  /** Submit the frame's recorded work. */
  endFrame(): void

  // Draw --------------------------------------------------------------------
  /** Record a draw into the current render pass. */
  draw(call: DrawCall): void

  // Present -----------------------------------------------------------------
  /**
   * Present `source`'s color to the default framebuffer (the canvas). WebGL2
   * blits; WebGPU draws a fullscreen pass into the swapchain texture. Called
   * outside a render pass.
   */
  present(
    source: RenderTarget,
    dstWidth: number,
    dstHeight: number,
    opts?: BlitOpts,
  ): void

  // Context loss ------------------------------------------------------------
  isContextLost(): boolean
  /** Register a listener; returns an unsubscribe function. */
  onContextLost(cb: () => void): () => void
  onContextRestored(cb: () => void): () => void

  // Teardown ----------------------------------------------------------------
  destroy(): void
}
