/**
 * WebGL2 implementation of `GfxDevice`. Owns the GL context and emulates the
 * pipeline/bind-group/render-pass model: a pipeline is a linked program plus
 * baked draw state, applied through independent self-eliding setters so
 * back-to-back draws that share state issue no redundant driver calls; a bind
 * group is a resolved set of UBO/texture bindings; a render pass is an FBO bind
 * plus load-op clears with an optional MSAA resolve on end.
 *
 * Context creation:
 *
 * - `antialias: false`, we own AA (shader-distance / offscreen MSAA).
 * - Premultiplied alpha end-to-end so the compositor doesn't double-multiply.
 * - `UNPACK_COLORSPACE_CONVERSION_WEBGL = NONE` guards against silent sRGB→linear
 *   on `ImageBitmap` / `HTMLImageElement` upload.
 *
 * Binding-number convention: `@binding` numbers are treated as globally unique
 * flat indices — uniform-buffer bindings index GL uniform-block binding points,
 * texture bindings index texture units. The shader reflection maps each binding
 * to its GLSL block/sampler name so the wiring survives naga's identifier
 * mangling. (`batchLayout.ts` assigns the flat numbers.)
 */

import type {
  BindGroup,
  BindGroupEntry,
  BindGroupLayout,
  BindGroupLayoutEntry,
  BindingType,
  BlitOpts,
  ColorFormat,
  CompareFn,
  CullMode,
  DeviceLimits,
  NdcConventions,
  DeviceStats,
  DrawCall,
  FrontFace,
  GfxBlendMode,
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
  VertexBufferLayout,
  VertexFormat,
} from '../GfxDevice'

// --- concrete backing structs (kept private, exposed as branded handles) ----

interface WebGL2Shader extends ShaderModule {
  gl: WebGLProgram
  /**
   * Sampler binding → GL sampler uniform name, wired to unit === binding at
   * link.
   */
  samplerBindings: { binding: number; glslName: string }[]
}

/** Current captured base byte-offset of each vertex slot, per cached VAO. */
interface WebGL2Vao {
  gl: WebGLVertexArrayObject
  slotOffsets: number[]
  indexType?: IndexType
}

interface WebGL2Pipeline extends Pipeline {
  shader: WebGL2Shader
  vertexLayout: VertexBufferLayout[]
  color: { format: ColorFormat; blend: GfxBlendMode } | null
  depth: {
    test: boolean
    write: boolean
    compare: CompareFn
    biasSlopeScale: number
    biasConstant: number
  } | null
  cull: CullMode
  frontFace: FrontFace
  mode: number // gl.TRIANGLES | gl.LINES
  samples: number
  /**
   * VAOs keyed on the bound buffer-set (vertex buffers + optional index
   * buffer).
   */
  vaoCache: Map<string, WebGL2Vao>
}

interface WebGL2BindGroupLayout extends BindGroupLayout {
  entries: BindGroupLayoutEntry[]
}

/**
 * A resolved bind entry, precomputed at `createBindGroup` and sorted by
 * binding.
 */
interface ResolvedBinding {
  binding: number
  type: BindingType
  dynamic: boolean
  ubo?: WebGL2UniformBuffer
  offset: number
  size?: number
  tex?: WebGL2Texture
  shadowArray?: WebGL2ShadowArray
  shadowCube?: WebGL2ShadowCube
}

interface WebGL2BindGroup extends BindGroup {
  bindings: ResolvedBinding[]
}

interface WebGL2Buffer extends VBuffer {
  gl: WebGLBuffer
  byteSize: number
  id: number
}

interface WebGL2UniformBuffer extends UBuffer {
  gl: WebGLBuffer
  byteSize: number
}

interface WebGL2IndexBuffer extends IBuffer {
  gl: WebGLBuffer
  byteSize: number
  indexType: IndexType
  id: number
}

interface WebGL2Texture extends Texture {
  gl: WebGLTexture
  width: number
  height: number
  filter: 'nearest' | 'linear'
  wrap: 'clamp' | 'repeat'
  srgb: boolean
  mipmap: boolean
}

interface WebGL2ShadowArray extends ShadowArray {
  gl: WebGLTexture
}

interface WebGL2ShadowCube extends ShadowCube {
  gl: WebGLTexture
}

/**
 * Discriminated color attachment. `samples === 1` uses a `color` texture,
 * `samples > 1` a `colorRb` multisample renderbuffer (resolved on pass end).
 */
export type WebGL2RenderTarget = RenderTarget & {
  fbo: WebGLFramebuffer
  width: number
  height: number
  samples: number
  depthRb?: WebGLRenderbuffer
} & (
    | { color: WebGL2Texture; colorRb?: undefined }
    | { color?: undefined; colorRb: WebGLRenderbuffer }
  )

// --- format tables ----------------------------------------------------------

interface FormatInfo {
  size: 1 | 2 | 3 | 4
  glType: number
  normalized: boolean
  byteSize: number
}

// --- device -----------------------------------------------------------------

export class WebGL2Device implements GfxDevice {
  readonly #gl: WebGL2RenderingContext
  readonly #canvas: HTMLCanvasElement

  #_contextLost = false
  readonly #lostCbs = new Set<() => void>()
  readonly #restoredCbs = new Set<() => void>()

  // Cached state; bind lazily so back-to-back identical calls are free. Blend,
  // depth-test, depth-write, cull, front-face, depth-func, and polygon offset
  // are INDEPENDENT caches so a pipeline that changes only one issues one call.
  #curProgram: WebGLProgram | null = null
  #curVaoGl: WebGLVertexArrayObject | null = null
  #curBlend: GfxBlendMode | null = null
  #curFbo: WebGLFramebuffer | null = null
  #shadowFbo: WebGLFramebuffer | null = null
  #curDepthTest = false
  #curDepthWrite = true
  #curDepthFunc: CompareFn | null = null
  #curCull: CullMode = 'none'
  #curFrontFace: FrontFace = 'ccw'
  #curPolyOffsetOn = false
  #curPolyOffset: [number, number] = [0, 0]
  #boundTex: (WebGLTexture | null)[] = []
  #boundTexTarget: number[] = []
  /**
   * The GL active texture unit. Raw texture create/upload paths bind against
   * whatever unit is active (without calling `activeTexture`), then unbind to
   * `null`, so the unit's cache entry must be invalidated afterward or a later
   * elided `#bindTextureUnit` would sample the `null`/stale binding.
   */
  #activeUnit = 0
  #boundArrayBuffer: WebGLBuffer | null = null
  #nextBufferId = 1

  /** Color attachment of the open pass, for the resolve on `endRenderPass`. */
  #passColor: {
    target: WebGL2RenderTarget
    resolveTarget?: WebGL2RenderTarget
  } | null = null

  readonly deviceStats: DeviceStats = {
    pipelineSwitches: 0,
    bindGroupSwitches: 0,
    textureBinds: 0,
  }

  readonly limits: DeviceLimits

  readonly backend = 'webgl2' as const

  /** WebGL conventions: `[-1,1]` depth, CCW front faces, bottom-up textures. */
  readonly ndc: NdcConventions = {
    clipDepth: 'neg-one-to-one',
    frontFace: 'ccw',
    textureTopDown: false,
  }

  readonly maxTextureSize: number
  readonly maxSamples: number
  readonly #anisoExt: EXT_texture_filter_anisotropic | null
  readonly #maxAnisotropy: number
  #warnedMaxTextureClamp = false
  #warnedMaxSamplesClamp = false

  /** Pipeline memoization: descriptor key → pipeline. */
  readonly #pipelineCache = new Map<string, WebGL2Pipeline>()

  constructor(canvas: HTMLCanvasElement) {
    this.#canvas = canvas
    const gl = canvas.getContext('webgl2', {
      alpha: true,
      premultipliedAlpha: true,
      antialias: false,
      depth: false,
      stencil: false,
      preserveDrawingBuffer: false,
    })
    if (!gl) {
      throw new Error('WebGL2Device: failed to acquire WebGL2 context')
    }
    this.#gl = gl
    this.maxTextureSize = gl.getParameter(gl.MAX_TEXTURE_SIZE) as number
    this.maxSamples = gl.getParameter(gl.MAX_SAMPLES) as number
    this.limits = {
      minUniformBufferOffsetAlignment: gl.getParameter(
        gl.UNIFORM_BUFFER_OFFSET_ALIGNMENT,
      ) as number,
    }
    this.#anisoExt = gl.getExtension('EXT_texture_filter_anisotropic')
    this.#maxAnisotropy = this.#anisoExt
      ? (gl.getParameter(
          this.#anisoExt.MAX_TEXTURE_MAX_ANISOTROPY_EXT,
        ) as number)
      : 1
    gl.disable(gl.CULL_FACE)
    gl.frontFace(gl.CCW)
    gl.disable(gl.DEPTH_TEST)
    gl.depthFunc(gl.LEQUAL)
    this.#curDepthFunc = 'less-equal'
    gl.disable(gl.STENCIL_TEST)
    gl.disable(gl.POLYGON_OFFSET_FILL)
    gl.enable(gl.BLEND)

    canvas.addEventListener('webglcontextlost', this.#onLost, false)
    canvas.addEventListener('webglcontextrestored', this.#onRestored, false)
  }

  #clampSamples(samples: number): number {
    if (samples <= 1) return 1
    if (samples <= this.maxSamples) return Math.floor(samples)
    if (!this.#warnedMaxSamplesClamp) {
      this.#warnedMaxSamplesClamp = true
      console.warn(
        `WebGL2Device: requested MSAA ${samples}× exceeds driver MAX_SAMPLES ${this.maxSamples}; clamping.`,
      )
    }
    return this.maxSamples
  }

  #clampTextureDim(w: number, h: number): [number, number] {
    const cap = this.maxTextureSize
    if (w <= cap && h <= cap) return [w, h]
    if (!this.#warnedMaxTextureClamp) {
      this.#warnedMaxTextureClamp = true
      console.warn(
        `WebGL2Device: requested texture ${w}×${h} exceeds MAX_TEXTURE_SIZE ${cap}; clamping. Renders continue at the clamped size with GPU upscaling on present.`,
      )
    }
    return [Math.min(w, cap), Math.min(h, cap)]
  }

  /**
   * Force a context-loss for testing + field debugging. Uses
   * `WEBGL_lose_context` when available; falls back to synthesizing the DOM
   * events (happy-dom tests).
   */
  simulateContextLoss(): void {
    if (this.#_contextLost) return
    const ext = this.#gl.getExtension('WEBGL_lose_context') as {
      loseContext(): void
      restoreContext(): void
    } | null
    if (ext) ext.loseContext()
    this.#onLost(new Event('webglcontextlost'))
  }

  simulateContextRestored(): void {
    if (!this.#_contextLost) return
    const ext = this.#gl.getExtension('WEBGL_lose_context') as {
      loseContext(): void
      restoreContext(): void
    } | null
    if (ext) ext.restoreContext()
    this.#onRestored()
  }

  // --- shaders --------------------------------------------------------------

  createShaderModule(desc: ShaderModuleDesc): ShaderModule {
    const gl = this.#gl
    if (!desc.glsl) {
      throw new Error(
        'WebGL2Device.createShaderModule: no GLSL source in the shader module',
      )
    }
    const { vertex, fragment } = desc.glsl
    if (!vertex.startsWith('#version 300 es\n')) {
      throw new Error(
        'WebGL2Device.createShaderModule: vertex shader must start with `#version 300 es\\n`',
      )
    }
    if (!fragment.startsWith('#version 300 es\n')) {
      throw new Error(
        'WebGL2Device.createShaderModule: fragment shader must start with `#version 300 es\\n`',
      )
    }
    const vs = compileShader(gl, gl.VERTEX_SHADER, vertex)
    const fs = compileShader(gl, gl.FRAGMENT_SHADER, fragment)
    const program = gl.createProgram()
    if (!program)
      throw new Error(
        'WebGL2Device.createShaderModule: gl.createProgram returned null',
      )
    gl.attachShader(program, vs)
    gl.attachShader(program, fs)
    // Force attribute locations before link so `VertexAttribute.location` values
    // line up with the shader's `in` variables regardless of driver assignment.
    for (const a of desc.reflection.attributes) {
      gl.bindAttribLocation(program, a.location, a.glslName)
    }
    gl.linkProgram(program)
    if (!gl.getProgramParameter(program, gl.LINK_STATUS)) {
      const info = gl.getProgramInfoLog(program) ?? '<no info log>'
      gl.deleteProgram(program)
      gl.deleteShader(vs)
      gl.deleteShader(fs)
      throw new Error(
        `WebGL2Device.createShaderModule: link failed (${desc.label ?? 'shader'}):\n${info}`,
      )
    }
    gl.detachShader(program, vs)
    gl.detachShader(program, fs)
    gl.deleteShader(vs)
    gl.deleteShader(fs)
    // Point each declared uniform block at its binding index. A UBO bound there
    // (bind-group application) feeds this program.
    for (const b of desc.reflection.uniformBlocks) {
      const idx = gl.getUniformBlockIndex(program, b.glslName)
      if (idx !== gl.INVALID_INDEX) {
        gl.uniformBlockBinding(program, idx, b.binding)
      } else if (import.meta.env?.DEV) {
        // A reflection block that doesn't resolve reads all-zeros silently — the
        // catastrophic-but-invisible failure mode of a block-name typo. Surface
        // it in dev (a genuinely-unused block optimized out is the only false
        // positive, rare for a declared-and-referenced block).
        console.warn(
          `WebGL2Device: shader '${desc.label ?? '?'}' declares no active uniform block '${b.glslName}'`,
        )
      }
    }
    // Sampler → unit is fixed by the layout (unit === binding), so set it once
    // here; draws only bind textures to those units afterwards.
    const prevProgram = this.#curProgram
    gl.useProgram(program)
    this.#curProgram = program
    for (const s of desc.reflection.samplers) {
      const loc = gl.getUniformLocation(program, s.glslName)
      if (loc !== null) gl.uniform1i(loc, s.binding)
    }
    if (prevProgram !== null && prevProgram !== program) {
      gl.useProgram(prevProgram)
      this.#curProgram = prevProgram
    }
    return {
      __gfxShader: undefined as never,
      gl: program,
      samplerBindings: desc.reflection.samplers,
    } as WebGL2Shader
  }

  deleteShaderModule(s: ShaderModule): void {
    const w = s as WebGL2Shader
    if (this.#curProgram === w.gl) this.#curProgram = null
    this.#gl.deleteProgram(w.gl)
  }

  // --- pipelines ------------------------------------------------------------

  createPipeline(desc: PipelineDesc): Promise<Pipeline> {
    const key = pipelineKey(desc)
    const cached = this.#pipelineCache.get(key)
    if (cached) return Promise.resolve(cached)
    const gl = this.#gl
    const pipeline: WebGL2Pipeline = {
      __gfxPipeline: undefined as never,
      shader: desc.shader as WebGL2Shader,
      vertexLayout: desc.vertexLayout,
      color: desc.color,
      depth: desc.depth
        ? {
            test: desc.depth.test,
            write: desc.depth.write,
            compare: desc.depth.compare ?? 'less-equal',
            biasSlopeScale: desc.depth.biasSlopeScale ?? 0,
            biasConstant: desc.depth.biasConstant ?? 0,
          }
        : null,
      cull: desc.cull,
      frontFace: desc.frontFace,
      mode: desc.primitive === 'line-list' ? gl.LINES : gl.TRIANGLES,
      samples: desc.samples,
      vaoCache: new Map(),
    }
    this.#pipelineCache.set(key, pipeline)
    return Promise.resolve(pipeline)
  }

  // --- bind groups ----------------------------------------------------------

  createBindGroupLayout(entries: BindGroupLayoutEntry[]): BindGroupLayout {
    return {
      __gfxBindGroupLayout: undefined as never,
      entries: entries.slice(),
    } as WebGL2BindGroupLayout
  }

  createBindGroup(
    layout: BindGroupLayout,
    entries: BindGroupEntry[],
  ): BindGroup {
    const l = layout as WebGL2BindGroupLayout
    const bindings: ResolvedBinding[] = entries.map((e) => {
      const le = l.entries.find((x) => x.binding === e.binding)
      if (!le)
        throw new Error(
          `WebGL2Device.createBindGroup: binding ${e.binding} not in layout`,
        )
      const r: ResolvedBinding = {
        binding: e.binding,
        type: le.type,
        dynamic: le.dynamicOffset ?? false,
        offset: 0,
      }
      const res = e.resource
      if ('uniformBuffer' in res) {
        r.ubo = res.uniformBuffer as WebGL2UniformBuffer
        r.offset = res.offset ?? 0
        r.size = res.size
      } else if ('texture' in res) {
        r.tex = res.texture as WebGL2Texture
      } else if ('shadowArray' in res) {
        r.shadowArray = res.shadowArray as WebGL2ShadowArray
      } else {
        r.shadowCube = res.shadowCube as WebGL2ShadowCube
      }
      return r
    })
    // Sort by binding so dynamic-offset consumption is deterministic (ascending
    // dynamic-binding order, matching `DrawBindGroup.dynamicOffsets`).
    bindings.sort((a, b) => a.binding - b.binding)
    return { __gfxBindGroup: undefined as never, bindings } as WebGL2BindGroup
  }

  deleteBindGroup(_g: BindGroup): void {
    // Bind groups hold no GL objects of their own (they reference buffers /
    // textures); nothing to release.
    void _g
  }

  // --- vertex buffers -------------------------------------------------------

  #bindArrayBuffer(buf: WebGLBuffer | null): void {
    if (this.#boundArrayBuffer === buf) return
    this.#gl.bindBuffer(this.#gl.ARRAY_BUFFER, buf)
    this.#boundArrayBuffer = buf
  }

  createVertexBuffer(byteSize: number): VBuffer {
    const gl = this.#gl
    const buf = gl.createBuffer()
    if (!buf)
      throw new Error(
        'WebGL2Device.createVertexBuffer: createBuffer returned null',
      )
    this.#bindArrayBuffer(buf)
    gl.bufferData(gl.ARRAY_BUFFER, byteSize, gl.DYNAMIC_DRAW)
    return {
      __gfxBuffer: undefined as never,
      gl: buf,
      byteSize,
      id: this.#nextBufferId++,
    } as WebGL2Buffer
  }

  updateBufferSubData(
    buf: VBuffer,
    byteOffset: number,
    src: ArrayBufferView,
    srcOffsetBytes = 0,
    byteLength?: number,
  ): void {
    const gl = this.#gl
    const b = buf as WebGL2Buffer
    this.#bindArrayBuffer(b.gl)
    const bytesPerElement =
      (src as { BYTES_PER_ELEMENT?: number }).BYTES_PER_ELEMENT ?? 1
    const srcOffsetElements = srcOffsetBytes / bytesPerElement
    const lengthElements =
      byteLength !== undefined
        ? byteLength / bytesPerElement
        : (src.byteLength - srcOffsetBytes) / bytesPerElement
    gl.bufferSubData(
      gl.ARRAY_BUFFER,
      byteOffset,
      src,
      srcOffsetElements,
      lengthElements,
    )
  }

  deleteBuffer(buf: VBuffer): void {
    const b = buf as WebGL2Buffer
    if (this.#boundArrayBuffer === b.gl) this.#boundArrayBuffer = null
    this.#gl.deleteBuffer(b.gl)
  }

  orphanBuffer(buf: VBuffer): void {
    const gl = this.#gl
    const b = buf as WebGL2Buffer
    this.#bindArrayBuffer(b.gl)
    gl.bufferData(gl.ARRAY_BUFFER, b.byteSize, gl.DYNAMIC_DRAW)
  }

  // --- uniform buffers ------------------------------------------------------

  createUniformBuffer(byteSize: number): UBuffer {
    const gl = this.#gl
    const buf = gl.createBuffer()
    if (!buf)
      throw new Error(
        'WebGL2Device.createUniformBuffer: createBuffer returned null',
      )
    gl.bindBuffer(gl.UNIFORM_BUFFER, buf)
    gl.bufferData(gl.UNIFORM_BUFFER, byteSize, gl.DYNAMIC_DRAW)
    gl.bindBuffer(gl.UNIFORM_BUFFER, null)
    return {
      __gfxUniformBuffer: undefined as never,
      gl: buf,
      byteSize,
    } as WebGL2UniformBuffer
  }

  updateUniformBuffer(
    buf: UBuffer,
    data: ArrayBufferView,
    byteOffset = 0,
  ): void {
    const gl = this.#gl
    const b = buf as WebGL2UniformBuffer
    gl.bindBuffer(gl.UNIFORM_BUFFER, b.gl)
    gl.bufferSubData(gl.UNIFORM_BUFFER, byteOffset, data)
    gl.bindBuffer(gl.UNIFORM_BUFFER, null)
  }

  orphanUniformBuffer(buf: UBuffer): void {
    const gl = this.#gl
    const b = buf as WebGL2UniformBuffer
    gl.bindBuffer(gl.UNIFORM_BUFFER, b.gl)
    gl.bufferData(gl.UNIFORM_BUFFER, b.byteSize, gl.DYNAMIC_DRAW)
    gl.bindBuffer(gl.UNIFORM_BUFFER, null)
  }

  deleteUniformBuffer(buf: UBuffer): void {
    this.#gl.deleteBuffer((buf as WebGL2UniformBuffer).gl)
  }

  // --- index buffers --------------------------------------------------------

  /**
   * The `ELEMENT_ARRAY_BUFFER` binding is captured by whichever VAO is bound,
   * so every index-buffer op resets to the default VAO first to avoid
   * corrupting a pipeline VAO's captured element binding.
   */
  #detachVaoForElementOp(): void {
    if (this.#curVaoGl !== null) {
      this.#gl.bindVertexArray(null)
      this.#curVaoGl = null
    }
  }

  createIndexBuffer(byteSize: number, type: IndexType = 'u16'): IBuffer {
    const gl = this.#gl
    const buf = gl.createBuffer()
    if (!buf)
      throw new Error(
        'WebGL2Device.createIndexBuffer: createBuffer returned null',
      )
    this.#detachVaoForElementOp()
    gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, buf)
    gl.bufferData(gl.ELEMENT_ARRAY_BUFFER, byteSize, gl.STATIC_DRAW)
    gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, null)
    return {
      __gfxIndexBuffer: undefined as never,
      gl: buf,
      byteSize,
      indexType: type,
      id: this.#nextBufferId++,
    } as WebGL2IndexBuffer
  }

  updateIndexBufferSubData(
    buf: IBuffer,
    byteOffset: number,
    src: Uint16Array | Uint32Array,
  ): void {
    const gl = this.#gl
    this.#detachVaoForElementOp()
    gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, (buf as WebGL2IndexBuffer).gl)
    gl.bufferSubData(gl.ELEMENT_ARRAY_BUFFER, byteOffset, src)
    gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, null)
  }

  deleteIndexBuffer(buf: IBuffer): void {
    this.#gl.deleteBuffer((buf as WebGL2IndexBuffer).gl)
  }

  // --- textures -------------------------------------------------------------

  createTexture2D(opts: Texture2DOpts): Texture {
    const gl = this.#gl
    const tex = gl.createTexture()
    if (!tex)
      throw new Error(
        'WebGL2Device.createTexture2D: createTexture returned null',
      )
    const [clampedW, clampedH] = this.#clampTextureDim(opts.width, opts.height)
    const filter = opts.filter ?? 'linear'
    const wrap = opts.wrap ?? 'clamp'
    const srgb = opts.srgb ?? false
    const mipmap = opts.mipmap ?? false
    gl.bindTexture(gl.TEXTURE_2D, tex)
    gl.texImage2D(
      gl.TEXTURE_2D,
      0,
      srgb ? gl.SRGB8_ALPHA8 : gl.RGBA8,
      clampedW,
      clampedH,
      0,
      gl.RGBA,
      gl.UNSIGNED_BYTE,
      null,
    )
    const minFilter = mipmap
      ? filter === 'linear'
        ? gl.LINEAR_MIPMAP_LINEAR
        : gl.NEAREST_MIPMAP_NEAREST
      : filter === 'linear'
        ? gl.LINEAR
        : gl.NEAREST
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, minFilter)
    gl.texParameteri(
      gl.TEXTURE_2D,
      gl.TEXTURE_MAG_FILTER,
      filter === 'linear' ? gl.LINEAR : gl.NEAREST,
    )
    gl.texParameteri(
      gl.TEXTURE_2D,
      gl.TEXTURE_WRAP_S,
      wrap === 'clamp' ? gl.CLAMP_TO_EDGE : gl.REPEAT,
    )
    gl.texParameteri(
      gl.TEXTURE_2D,
      gl.TEXTURE_WRAP_T,
      wrap === 'clamp' ? gl.CLAMP_TO_EDGE : gl.REPEAT,
    )
    if (mipmap && this.#anisoExt && (opts.anisotropy ?? 1) > 1) {
      gl.texParameterf(
        gl.TEXTURE_2D,
        this.#anisoExt.TEXTURE_MAX_ANISOTROPY_EXT,
        Math.min(opts.anisotropy ?? 1, this.#maxAnisotropy),
      )
    }
    gl.bindTexture(gl.TEXTURE_2D, null)
    this.#invalidateActiveUnit()
    return {
      __gfxTexture: undefined as never,
      gl: tex,
      width: clampedW,
      height: clampedH,
      filter,
      wrap,
      srgb,
      mipmap,
    } as WebGL2Texture
  }

  updateTextureSubImage2D(
    tex: Texture,
    xOffset: number,
    yOffset: number,
    source: TexImageSource,
    opts: TextureUploadOpts = {},
  ): void {
    const gl = this.#gl
    const t = tex as WebGL2Texture
    gl.bindTexture(gl.TEXTURE_2D, t.gl)
    this.#boundTexInvalidate(t.gl)
    gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, opts.flipY ? 1 : 0)
    gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, opts.premultiply ? 1 : 0)
    gl.pixelStorei(gl.UNPACK_COLORSPACE_CONVERSION_WEBGL, gl.NONE)
    gl.texSubImage2D(
      gl.TEXTURE_2D,
      0,
      xOffset,
      yOffset,
      gl.RGBA,
      gl.UNSIGNED_BYTE,
      source,
    )
    gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, 0)
    gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, 0)
    gl.bindTexture(gl.TEXTURE_2D, null)
    this.#invalidateActiveUnit()
  }

  updateTexture2D(
    tex: Texture,
    source: TexImageSource | null,
    opts: TextureUploadOpts = {},
  ): void {
    const gl = this.#gl
    const t = tex as WebGL2Texture
    if (source === null) return
    gl.bindTexture(gl.TEXTURE_2D, t.gl)
    this.#boundTexInvalidate(t.gl)
    gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, opts.flipY ? 1 : 0)
    gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, opts.premultiply ? 1 : 0)
    gl.pixelStorei(gl.UNPACK_COLORSPACE_CONVERSION_WEBGL, gl.NONE)
    const w = getSourceWidth(source)
    const h = getSourceHeight(source)
    if (w === t.width && h === t.height) {
      gl.texSubImage2D(
        gl.TEXTURE_2D,
        0,
        0,
        0,
        gl.RGBA,
        gl.UNSIGNED_BYTE,
        source,
      )
    } else {
      gl.texImage2D(
        gl.TEXTURE_2D,
        0,
        t.srgb ? gl.SRGB8_ALPHA8 : gl.RGBA8,
        gl.RGBA,
        gl.UNSIGNED_BYTE,
        source,
      )
      ;(t as { width: number }).width = w
      ;(t as { height: number }).height = h
    }
    if (t.mipmap) gl.generateMipmap(gl.TEXTURE_2D)
    gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, 0)
    gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, 0)
    gl.bindTexture(gl.TEXTURE_2D, null)
    this.#invalidateActiveUnit()
  }

  deleteTexture(tex: Texture): void {
    const t = tex as WebGL2Texture
    this.#boundTexInvalidate(t.gl)
    this.#gl.deleteTexture(t.gl)
  }

  /** Drop a handle from the per-unit bind cache (delete / mutating upload). */
  #boundTexInvalidate(handle: WebGLTexture): void {
    for (let u = 0; u < this.#boundTex.length; u++) {
      if (this.#boundTex[u] === handle) this.#boundTex[u] = null
    }
  }

  // --- render targets -------------------------------------------------------

  createRenderTarget(opts: RenderTargetOpts): RenderTarget {
    const gl = this.#gl
    const samples = this.#clampSamples(opts.samples ?? 1)
    const fbo = gl.createFramebuffer()
    if (!fbo)
      throw new Error(
        'WebGL2Device.createRenderTarget: createFramebuffer returned null',
      )
    const [clampedW, clampedH] = this.#clampTextureDim(opts.width, opts.height)

    let rt: WebGL2RenderTarget
    gl.bindFramebuffer(gl.FRAMEBUFFER, fbo)
    this.#curFbo = fbo
    if (samples > 1) {
      const rb = gl.createRenderbuffer()
      if (!rb) {
        gl.deleteFramebuffer(fbo)
        throw new Error(
          'WebGL2Device.createRenderTarget: createRenderbuffer returned null',
        )
      }
      gl.bindRenderbuffer(gl.RENDERBUFFER, rb)
      gl.renderbufferStorageMultisample(
        gl.RENDERBUFFER,
        samples,
        gl.RGBA8,
        clampedW,
        clampedH,
      )
      gl.bindRenderbuffer(gl.RENDERBUFFER, null)
      gl.framebufferRenderbuffer(
        gl.FRAMEBUFFER,
        gl.COLOR_ATTACHMENT0,
        gl.RENDERBUFFER,
        rb,
      )
      rt = {
        __gfxRenderTarget: undefined as never,
        fbo,
        colorRb: rb,
        width: clampedW,
        height: clampedH,
        samples,
        colorSpace: 'linear',
        hasDepth: !!opts.depth,
      } as WebGL2RenderTarget
    } else {
      const color = this.createTexture2D({
        width: clampedW,
        height: clampedH,
        filter: 'linear',
        wrap: 'clamp',
        srgb: opts.colorSpace === 'srgb',
      }) as WebGL2Texture
      gl.bindFramebuffer(gl.FRAMEBUFFER, fbo)
      gl.framebufferTexture2D(
        gl.FRAMEBUFFER,
        gl.COLOR_ATTACHMENT0,
        gl.TEXTURE_2D,
        color.gl,
        0,
      )
      rt = {
        __gfxRenderTarget: undefined as never,
        fbo,
        color,
        width: clampedW,
        height: clampedH,
        samples: 1,
        colorSpace: opts.colorSpace ?? 'linear',
        hasDepth: !!opts.depth,
      } as WebGL2RenderTarget
    }
    if (opts.depth) {
      const drb = gl.createRenderbuffer()
      if (!drb) {
        this.deleteRenderTarget(rt)
        throw new Error(
          'WebGL2Device.createRenderTarget: depth createRenderbuffer returned null',
        )
      }
      gl.bindRenderbuffer(gl.RENDERBUFFER, drb)
      if (samples > 1) {
        gl.renderbufferStorageMultisample(
          gl.RENDERBUFFER,
          samples,
          gl.DEPTH24_STENCIL8,
          clampedW,
          clampedH,
        )
      } else {
        gl.renderbufferStorage(
          gl.RENDERBUFFER,
          gl.DEPTH24_STENCIL8,
          clampedW,
          clampedH,
        )
      }
      gl.bindRenderbuffer(gl.RENDERBUFFER, null)
      gl.framebufferRenderbuffer(
        gl.FRAMEBUFFER,
        gl.DEPTH_STENCIL_ATTACHMENT,
        gl.RENDERBUFFER,
        drb,
      )
      rt.depthRb = drb
    }
    const status = gl.checkFramebufferStatus(gl.FRAMEBUFFER)
    gl.bindFramebuffer(gl.FRAMEBUFFER, null)
    this.#curFbo = null
    if (status !== gl.FRAMEBUFFER_COMPLETE) {
      this.deleteRenderTarget(rt)
      throw new Error(
        `WebGL2Device.createRenderTarget: framebuffer incomplete (status 0x${status.toString(16)})`,
      )
    }
    return rt
  }

  resizeRenderTarget(rt: RenderTarget, width: number, height: number): void {
    const gl = this.#gl
    const r = rt as WebGL2RenderTarget
    const [clampedW, clampedH] = this.#clampTextureDim(width, height)
    if (r.width === clampedW && r.height === clampedH) return
    if (r.colorRb !== undefined) {
      gl.bindRenderbuffer(gl.RENDERBUFFER, r.colorRb)
      gl.renderbufferStorageMultisample(
        gl.RENDERBUFFER,
        r.samples,
        gl.RGBA8,
        clampedW,
        clampedH,
      )
      gl.bindRenderbuffer(gl.RENDERBUFFER, null)
    } else if (r.color !== undefined) {
      gl.bindTexture(gl.TEXTURE_2D, r.color.gl)
      gl.texImage2D(
        gl.TEXTURE_2D,
        0,
        r.color.srgb ? gl.SRGB8_ALPHA8 : gl.RGBA8,
        clampedW,
        clampedH,
        0,
        gl.RGBA,
        gl.UNSIGNED_BYTE,
        null,
      )
      gl.bindTexture(gl.TEXTURE_2D, null)
      this.#invalidateActiveUnit()
      ;(r.color as { width: number }).width = clampedW
      ;(r.color as { height: number }).height = clampedH
    }
    if (r.depthRb !== undefined) {
      gl.bindRenderbuffer(gl.RENDERBUFFER, r.depthRb)
      if (r.samples > 1) {
        gl.renderbufferStorageMultisample(
          gl.RENDERBUFFER,
          r.samples,
          gl.DEPTH24_STENCIL8,
          clampedW,
          clampedH,
        )
      } else {
        gl.renderbufferStorage(
          gl.RENDERBUFFER,
          gl.DEPTH24_STENCIL8,
          clampedW,
          clampedH,
        )
      }
      gl.bindRenderbuffer(gl.RENDERBUFFER, null)
    }
    ;(r as { width: number }).width = clampedW
    ;(r as { height: number }).height = clampedH
  }

  deleteRenderTarget(rt: RenderTarget): void {
    const r = rt as WebGL2RenderTarget
    this.#gl.deleteFramebuffer(r.fbo)
    if (r.colorRb !== undefined) {
      this.#gl.deleteRenderbuffer(r.colorRb)
    } else if (r.color !== undefined) {
      this.deleteTexture(r.color)
    }
    if (r.depthRb !== undefined) this.#gl.deleteRenderbuffer(r.depthRb)
  }

  colorTexture(rt: RenderTarget): Texture {
    const r = rt as WebGL2RenderTarget
    if (r.color === undefined) {
      throw new Error(
        'WebGL2Device.colorTexture: target is multisample (not sampleable); resolve it first',
      )
    }
    return r.color
  }

  // --- shadow maps ----------------------------------------------------------

  createShadowArray(
    size: number,
    layers: number,
    compare: CompareFn = 'less-equal',
  ): ShadowArray {
    const gl = this.#gl
    const tex = gl.createTexture()
    if (!tex)
      throw new Error(
        'WebGL2Device.createShadowArray: createTexture returned null',
      )
    gl.bindTexture(gl.TEXTURE_2D_ARRAY, tex)
    gl.texStorage3D(
      gl.TEXTURE_2D_ARRAY,
      1,
      gl.DEPTH_COMPONENT24,
      size,
      size,
      layers,
    )
    this.#setShadowSampling(gl.TEXTURE_2D_ARRAY, compare)
    gl.bindTexture(gl.TEXTURE_2D_ARRAY, null)
    this.#invalidateActiveUnit()
    return {
      __gfxShadowArray: undefined as never,
      gl: tex,
      size,
      layers,
    } as WebGL2ShadowArray
  }

  createShadowCube(
    size: number,
    compare: CompareFn = 'less-equal',
  ): ShadowCube {
    const gl = this.#gl
    const tex = gl.createTexture()
    if (!tex)
      throw new Error(
        'WebGL2Device.createShadowCube: createTexture returned null',
      )
    gl.bindTexture(gl.TEXTURE_CUBE_MAP, tex)
    gl.texStorage2D(gl.TEXTURE_CUBE_MAP, 1, gl.DEPTH_COMPONENT24, size, size)
    this.#setShadowSampling(gl.TEXTURE_CUBE_MAP, compare)
    gl.texParameteri(gl.TEXTURE_CUBE_MAP, gl.TEXTURE_WRAP_R, gl.CLAMP_TO_EDGE)
    gl.bindTexture(gl.TEXTURE_CUBE_MAP, null)
    this.#invalidateActiveUnit()
    return {
      __gfxShadowCube: undefined as never,
      gl: tex,
      size,
    } as WebGL2ShadowCube
  }

  #setShadowSampling(target: number, compare: CompareFn): void {
    const gl = this.#gl
    gl.texParameteri(target, gl.TEXTURE_MIN_FILTER, gl.LINEAR)
    gl.texParameteri(target, gl.TEXTURE_MAG_FILTER, gl.LINEAR)
    gl.texParameteri(target, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE)
    gl.texParameteri(target, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE)
    gl.texParameteri(target, gl.TEXTURE_COMPARE_MODE, gl.COMPARE_REF_TO_TEXTURE)
    gl.texParameteri(target, gl.TEXTURE_COMPARE_FUNC, compareFnGl(gl, compare))
  }

  deleteShadowArray(s: ShadowArray): void {
    this.#gl.deleteTexture((s as WebGL2ShadowArray).gl)
  }

  deleteShadowCube(s: ShadowCube): void {
    this.#gl.deleteTexture((s as WebGL2ShadowCube).gl)
  }

  #ensureShadowFbo(): WebGLFramebuffer {
    if (!this.#shadowFbo) {
      const fbo = this.#gl.createFramebuffer()
      if (!fbo)
        throw new Error('WebGL2Device: shadow createFramebuffer returned null')
      this.#shadowFbo = fbo
    }
    return this.#shadowFbo
  }

  // --- frame lifecycle & passes ---------------------------------------------

  beginFrame(): void {
    this.deviceStats.pipelineSwitches = 0
    this.deviceStats.bindGroupSwitches = 0
    this.deviceStats.textureBinds = 0
  }

  beginRenderPass(desc: RenderPassDesc): void {
    const gl = this.#gl
    const depthTarget = desc.depth?.target
    // Depth-only shadow pass: a shadow array layer / cube face, no color.
    if (
      depthTarget &&
      !('renderTarget' in depthTarget) &&
      desc.color === undefined
    ) {
      const size =
        'shadowArray' in depthTarget
          ? (depthTarget.shadowArray as WebGL2ShadowArray).size
          : (depthTarget.shadowCube as WebGL2ShadowCube).size
      gl.bindFramebuffer(gl.FRAMEBUFFER, this.#ensureShadowFbo())
      this.#curFbo = this.#shadowFbo
      if ('shadowArray' in depthTarget) {
        gl.framebufferTextureLayer(
          gl.FRAMEBUFFER,
          gl.DEPTH_ATTACHMENT,
          (depthTarget.shadowArray as WebGL2ShadowArray).gl,
          0,
          depthTarget.layer,
        )
      } else {
        gl.framebufferTexture2D(
          gl.FRAMEBUFFER,
          gl.DEPTH_ATTACHMENT,
          gl.TEXTURE_CUBE_MAP_POSITIVE_X + depthTarget.face,
          (depthTarget.shadowCube as WebGL2ShadowCube).gl,
          0,
        )
      }
      gl.drawBuffers([gl.NONE])
      gl.readBuffer(gl.NONE)
      gl.viewport(0, 0, size, size)
      if ((desc.depth?.loadOp ?? 'clear') === 'clear') {
        this.setDepthWrite(true)
        gl.clearDepth(desc.depth?.clearValue ?? 1.0)
        gl.clear(gl.DEPTH_BUFFER_BIT)
      }
      this.#passColor = null
      return
    }

    // Color pass (optionally with depth on the same FBO).
    const color = desc.color
    if (!color) {
      throw new Error(
        'WebGL2Device.beginRenderPass: a non-shadow pass requires a color attachment',
      )
    }
    const target = color.target as WebGL2RenderTarget
    if (this.#curFbo !== target.fbo) {
      gl.bindFramebuffer(gl.FRAMEBUFFER, target.fbo)
      this.#curFbo = target.fbo
    }
    // A color FBO created with drawBuffers NONE (reused shadow FBO) is not our
    // case here — color targets carry COLOR_ATTACHMENT0 as the draw buffer.
    gl.viewport(0, 0, target.width, target.height)
    let mask = 0
    if (color.loadOp === 'clear') {
      const c = color.clearColor ?? [0, 0, 0, 0]
      // Premultiplied clear for premultiplied surfaces.
      gl.clearColor(c[0] * c[3], c[1] * c[3], c[2] * c[3], c[3])
      mask |= gl.COLOR_BUFFER_BIT
    }
    if (desc.depth && desc.depth.loadOp === 'clear') {
      this.setDepthWrite(true)
      gl.clearDepth(desc.depth.clearValue ?? 1.0)
      mask |= gl.DEPTH_BUFFER_BIT
    }
    if (mask !== 0) gl.clear(mask)
    this.#passColor = {
      target,
      resolveTarget: color.resolveTarget as WebGL2RenderTarget | undefined,
    }
  }

  endRenderPass(): void {
    const pass = this.#passColor
    this.#passColor = null
    if (!pass || !pass.resolveTarget) return
    // Resolve the MSAA color into the single-sample resolve target.
    const gl = this.#gl
    const s = pass.target
    const d = pass.resolveTarget
    // A multisample resolve blit forbids scaling: source and resolve bounds must
    // match (the caller allocates the resolve target at the source's size).
    if (s.width !== d.width || s.height !== d.height) {
      throw new Error(
        `WebGL2Device.endRenderPass: resolve target ${d.width}×${d.height} must match source ${s.width}×${s.height}`,
      )
    }
    gl.bindFramebuffer(gl.READ_FRAMEBUFFER, s.fbo)
    gl.bindFramebuffer(gl.DRAW_FRAMEBUFFER, d.fbo)
    gl.blitFramebuffer(
      0,
      0,
      s.width,
      s.height,
      0,
      0,
      d.width,
      d.height,
      gl.COLOR_BUFFER_BIT,
      gl.NEAREST,
    )
    gl.bindFramebuffer(gl.FRAMEBUFFER, null)
    this.#curFbo = null
  }

  endFrame(): void {
    // No device-level end work; `present` blits the frame to the canvas.
  }

  // --- draw -----------------------------------------------------------------

  draw(call: DrawCall): void {
    const gl = this.#gl
    const p = call.pipeline as WebGL2Pipeline
    this.#applyPipeline(p)
    const vao = this.#vaoFor(p, call)
    this.#bindVao(vao)
    this.#repointVertexOffsets(p, vao, call)
    this.#applyBindGroups(call)

    const first = call.first ?? 0
    const instances = call.instanceCount ?? 1
    if (call.indexBuffer) {
      const ib = call.indexBuffer as WebGL2IndexBuffer
      const glType =
        ib.indexType === 'u32' ? gl.UNSIGNED_INT : gl.UNSIGNED_SHORT
      const elemBytes = ib.indexType === 'u32' ? 4 : 2
      if (instances > 1) {
        gl.drawElementsInstanced(
          p.mode,
          call.indexCount ?? 0,
          glType,
          first * elemBytes,
          instances,
        )
      } else {
        gl.drawElements(p.mode, call.indexCount ?? 0, glType, first * elemBytes)
      }
    } else if (instances > 1) {
      gl.drawArraysInstanced(p.mode, first, call.vertexCount ?? 0, instances)
    } else {
      gl.drawArrays(p.mode, first, call.vertexCount ?? 0)
    }
  }

  #applyPipeline(p: WebGL2Pipeline): void {
    if (this.#curProgram !== p.shader.gl) {
      this.#gl.useProgram(p.shader.gl)
      this.#curProgram = p.shader.gl
      this.deviceStats.pipelineSwitches++
    }
    if (p.color) this.#setBlend(p.color.blend)
    if (p.depth) {
      this.#setDepthTest(p.depth.test)
      this.#setDepthWrite(p.depth.write)
      this.#setDepthFunc(p.depth.compare)
      this.#setPolygonOffset(p.depth.biasSlopeScale, p.depth.biasConstant)
    } else {
      this.#setDepthTest(false)
      this.#setPolygonOffset(0, 0)
    }
    this.#setCullFace(p.cull)
    this.#setFrontFace(p.frontFace)
  }

  #vaoFor(p: WebGL2Pipeline, call: DrawCall): WebGL2Vao {
    const key =
      call.vertexBuffers.map((v) => (v.buffer as WebGL2Buffer).id).join(',') +
      (call.indexBuffer ? '|' + (call.indexBuffer as WebGL2IndexBuffer).id : '')
    let vao = p.vaoCache.get(key)
    if (vao) return vao
    vao = this.#createVao(p, call)
    p.vaoCache.set(key, vao)
    return vao
  }

  #createVao(p: WebGL2Pipeline, call: DrawCall): WebGL2Vao {
    const gl = this.#gl
    const glVao = gl.createVertexArray()
    if (!glVao) throw new Error('WebGL2Device: createVertexArray returned null')
    gl.bindVertexArray(glVao)
    this.#curVaoGl = glVao
    const slotOffsets: number[] = []
    for (let i = 0; i < p.vertexLayout.length; i++) {
      const layout = p.vertexLayout[i]
      const binding = call.vertexBuffers[i]
      const buf = binding.buffer as WebGL2Buffer
      this.#bindArrayBuffer(buf.gl)
      const divisor = layout.stepMode === 'instance' ? 1 : 0
      for (const attr of layout.attributes) {
        const fmt = FORMAT_INFO[attr.format]
        gl.enableVertexAttribArray(attr.location)
        gl.vertexAttribPointer(
          attr.location,
          fmt.size,
          fmt.glType,
          fmt.normalized,
          layout.arrayStride,
          attr.offset + binding.offset,
        )
        gl.vertexAttribDivisor(attr.location, divisor)
      }
      slotOffsets[i] = binding.offset
    }
    let indexType: IndexType | undefined
    if (call.indexBuffer) {
      const ib = call.indexBuffer as WebGL2IndexBuffer
      gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, ib.gl)
      indexType = ib.indexType
    }
    return { gl: glVao, slotOffsets, indexType }
  }

  #bindVao(vao: WebGL2Vao): void {
    if (this.#curVaoGl === vao.gl) return
    this.#gl.bindVertexArray(vao.gl)
    this.#curVaoGl = vao.gl
  }

  /**
   * Re-point a slot's attributes when the draw's base byte-offset differs from
   * what the (shared) VAO currently captures — the WebGL2 stand-in for a
   * base-instance, and how one cached VAO replays many ring sub-ranges.
   */
  #repointVertexOffsets(
    p: WebGL2Pipeline,
    vao: WebGL2Vao,
    call: DrawCall,
  ): void {
    const gl = this.#gl
    for (let i = 0; i < p.vertexLayout.length; i++) {
      const binding = call.vertexBuffers[i]
      if (vao.slotOffsets[i] === binding.offset) continue
      const layout = p.vertexLayout[i]
      const buf = binding.buffer as WebGL2Buffer
      this.#bindArrayBuffer(buf.gl)
      const divisor = layout.stepMode === 'instance' ? 1 : 0
      for (const attr of layout.attributes) {
        const fmt = FORMAT_INFO[attr.format]
        gl.vertexAttribPointer(
          attr.location,
          fmt.size,
          fmt.glType,
          fmt.normalized,
          layout.arrayStride,
          attr.offset + binding.offset,
        )
        gl.vertexAttribDivisor(attr.location, divisor)
      }
      vao.slotOffsets[i] = binding.offset
    }
  }

  #applyBindGroups(call: DrawCall): void {
    const gl = this.#gl
    for (const dg of call.bindGroups) {
      const bg = dg.bindGroup as WebGL2BindGroup
      let dynIndex = 0
      for (const b of bg.bindings) {
        if (b.type === 'uniform-buffer') {
          const ubo = b.ubo!
          const dynOffset = b.dynamic
            ? (dg.dynamicOffsets?.[dynIndex++] ?? 0)
            : 0
          const off = b.offset + dynOffset
          if (b.size !== undefined) {
            // bindBufferRange requires the offset be a multiple of the driver's
            // UBO offset alignment; a misaligned offset is a caller bug (an
            // unpadded ring slice) that would otherwise fail as GL_INVALID_VALUE.
            const align = this.limits.minUniformBufferOffsetAlignment
            if (off % align !== 0) {
              throw new Error(
                `WebGL2Device: uniform buffer offset ${off} (binding ${b.binding}) is not a multiple of ${align}`,
              )
            }
            gl.bindBufferRange(
              gl.UNIFORM_BUFFER,
              b.binding,
              ubo.gl,
              off,
              b.size,
            )
          } else {
            gl.bindBufferBase(gl.UNIFORM_BUFFER, b.binding, ubo.gl)
          }
        } else {
          const target =
            b.type === 'texture-2d'
              ? gl.TEXTURE_2D
              : b.type === 'texture-cube-shadow'
                ? gl.TEXTURE_CUBE_MAP
                : gl.TEXTURE_2D_ARRAY
          const handle = b.tex?.gl ?? b.shadowArray?.gl ?? b.shadowCube!.gl
          this.#bindTextureUnit(b.binding, target, handle)
        }
      }
    }
  }

  #bindTextureUnit(unit: number, target: number, handle: WebGLTexture): void {
    if (
      this.#boundTex[unit] === handle &&
      this.#boundTexTarget[unit] === target
    )
      return
    const gl = this.#gl
    gl.activeTexture(gl.TEXTURE0 + unit)
    this.#activeUnit = unit
    gl.bindTexture(target, handle)
    this.#boundTex[unit] = handle
    this.#boundTexTarget[unit] = target
    this.deviceStats.textureBinds++
  }

  /**
   * Invalidate the active unit's cache entry after a raw create/upload path
   * bound and unbound a texture there — the unit no longer holds what the cache
   * says, so force the next `#bindTextureUnit` for it to actually bind.
   */
  #invalidateActiveUnit(): void {
    this.#boundTex[this.#activeUnit] = null
    this.#boundTexTarget[this.#activeUnit] = -1
  }

  // --- present --------------------------------------------------------------

  present(
    source: RenderTarget,
    dstWidth: number,
    dstHeight: number,
    opts: BlitOpts = {},
  ): void {
    const gl = this.#gl
    const r = source as WebGL2RenderTarget
    // A multisample source resolve via blitFramebuffer requires NEAREST and
    // identical bounds; single-sample allows LINEAR scaling.
    const filter =
      r.samples > 1
        ? gl.NEAREST
        : opts.filter === 'nearest'
          ? gl.NEAREST
          : gl.LINEAR
    gl.bindFramebuffer(gl.READ_FRAMEBUFFER, r.fbo)
    gl.bindFramebuffer(gl.DRAW_FRAMEBUFFER, null)
    gl.blitFramebuffer(
      0,
      0,
      r.width,
      r.height,
      0,
      0,
      dstWidth,
      dstHeight,
      gl.COLOR_BUFFER_BIT,
      filter,
    )
    gl.bindFramebuffer(gl.FRAMEBUFFER, null)
    this.#curFbo = null
  }

  // --- state setters (independent, self-eliding) ----------------------------

  #setBlend(mode: GfxBlendMode): void {
    if (this.#curBlend === mode) return
    const gl = this.#gl
    if (mode === 'none') {
      gl.disable(gl.BLEND)
    } else {
      if (this.#curBlend === 'none' || this.#curBlend === null)
        gl.enable(gl.BLEND)
      if (mode === 'source-over') {
        gl.blendFuncSeparate(
          gl.ONE,
          gl.ONE_MINUS_SRC_ALPHA,
          gl.ONE,
          gl.ONE_MINUS_SRC_ALPHA,
        )
      } else {
        gl.blendFunc(gl.ONE, gl.ONE)
      }
    }
    this.#curBlend = mode
  }

  #setDepthTest(enabled: boolean): void {
    if (this.#curDepthTest === enabled) return
    const gl = this.#gl
    if (enabled) gl.enable(gl.DEPTH_TEST)
    else gl.disable(gl.DEPTH_TEST)
    this.#curDepthTest = enabled
  }

  #setDepthWrite(enabled: boolean): void {
    if (this.#curDepthWrite === enabled) return
    this.#gl.depthMask(enabled)
    this.#curDepthWrite = enabled
  }

  // Public so shadow-pass clears (which need writes on) route through the cache.
  setDepthWrite(enabled: boolean): void {
    this.#setDepthWrite(enabled)
  }

  #setDepthFunc(compare: CompareFn): void {
    if (this.#curDepthFunc === compare) return
    this.#gl.depthFunc(compareFnGl(this.#gl, compare))
    this.#curDepthFunc = compare
  }

  #setCullFace(mode: CullMode): void {
    if (this.#curCull === mode) return
    const gl = this.#gl
    if (mode === 'none') {
      gl.disable(gl.CULL_FACE)
    } else {
      if (this.#curCull === 'none') gl.enable(gl.CULL_FACE)
      gl.cullFace(mode === 'back' ? gl.BACK : gl.FRONT)
    }
    this.#curCull = mode
  }

  #setFrontFace(ff: FrontFace): void {
    if (this.#curFrontFace === ff) return
    const gl = this.#gl
    gl.frontFace(ff === 'ccw' ? gl.CCW : gl.CW)
    this.#curFrontFace = ff
  }

  #setPolygonOffset(slope: number, constant: number): void {
    const on = slope !== 0 || constant !== 0
    const gl = this.#gl
    if (on !== this.#curPolyOffsetOn) {
      if (on) gl.enable(gl.POLYGON_OFFSET_FILL)
      else gl.disable(gl.POLYGON_OFFSET_FILL)
      this.#curPolyOffsetOn = on
    }
    if (
      on &&
      (this.#curPolyOffset[0] !== slope || this.#curPolyOffset[1] !== constant)
    ) {
      gl.polygonOffset(slope, constant)
      this.#curPolyOffset[0] = slope
      this.#curPolyOffset[1] = constant
    }
  }

  // --- context loss ---------------------------------------------------------

  isContextLost(): boolean {
    return this.#_contextLost || this.#gl.isContextLost()
  }

  onContextLost(cb: () => void): () => void {
    this.#lostCbs.add(cb)
    return () => this.#lostCbs.delete(cb)
  }

  onContextRestored(cb: () => void): () => void {
    this.#restoredCbs.add(cb)
    return () => this.#restoredCbs.delete(cb)
  }

  #onLost = (e: Event): void => {
    e.preventDefault()
    this.#_contextLost = true
    this.#curProgram = null
    this.#curVaoGl = null
    this.#curBlend = null
    this.#curFbo = null
    this.#shadowFbo = null
    this.#boundTex = []
    this.#boundTexTarget = []
    this.#boundArrayBuffer = null
    this.#passColor = null
    // Pipelines' cached programs/VAOs are dead; a rebuild recreates them.
    this.#pipelineCache.clear()
    for (const cb of this.#lostCbs) cb()
  }

  #onRestored = (): void => {
    this.#_contextLost = false
    for (const cb of this.#restoredCbs) cb()
  }

  destroy(): void {
    this.#canvas.removeEventListener('webglcontextlost', this.#onLost, false)
    this.#canvas.removeEventListener(
      'webglcontextrestored',
      this.#onRestored,
      false,
    )
    this.#lostCbs.clear()
    this.#restoredCbs.clear()
    if (!this.#_contextLost && !this.#gl.isContextLost()) {
      const ext = this.#gl.getExtension('WEBGL_lose_context') as {
        loseContext(): void
      } | null
      ext?.loseContext()
    }
    this.#_contextLost = true
  }
}

// --- helpers ----------------------------------------------------------------

// WebGL enum values are spec-fixed, so use the literals rather than a
// `WebGL2RenderingContext.*` static reference (that global is absent under
// happy-dom and would crash at module load). FLOAT = 0x1406, UBYTE = 0x1401.
const GL_FLOAT = 0x1406
const GL_UNSIGNED_BYTE = 0x1401
const FORMAT_INFO: Record<VertexFormat, FormatInfo> = {
  float32: { size: 1, glType: GL_FLOAT, normalized: false, byteSize: 4 },
  float32x2: { size: 2, glType: GL_FLOAT, normalized: false, byteSize: 8 },
  float32x3: { size: 3, glType: GL_FLOAT, normalized: false, byteSize: 12 },
  float32x4: { size: 4, glType: GL_FLOAT, normalized: false, byteSize: 16 },
  unorm8x4: {
    size: 4,
    glType: GL_UNSIGNED_BYTE,
    normalized: true,
    byteSize: 4,
  },
  uint8x4: {
    size: 4,
    glType: GL_UNSIGNED_BYTE,
    normalized: false,
    byteSize: 4,
  },
}

function compareFnGl(gl: WebGL2RenderingContext, c: CompareFn): number {
  switch (c) {
    case 'less-equal':
      return gl.LEQUAL
    case 'greater-equal':
      return gl.GEQUAL
    case 'less':
      return gl.LESS
    case 'greater':
      return gl.GREATER
  }
}

/**
 * Stable string key for pipeline memoization: handle identity for
 * shader/layouts (via ids assigned lazily), structural for scalars.
 */
const pipelineIdTag = Symbol('gfxPipelineId')
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

function compileShader(
  gl: WebGL2RenderingContext,
  kind: number,
  src: string,
): WebGLShader {
  const s = gl.createShader(kind)
  if (!s) throw new Error('WebGL2Device: createShader returned null')
  gl.shaderSource(s, src)
  gl.compileShader(s)
  if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) {
    const info = gl.getShaderInfoLog(s) ?? '<no info log>'
    gl.deleteShader(s)
    const stage = kind === gl.VERTEX_SHADER ? 'vertex' : 'fragment'
    throw new Error(`WebGL2Device: ${stage} shader compile failed:\n${info}`)
  }
  return s
}

function getSourceWidth(source: TexImageSource): number {
  if ('width' in source && typeof source.width === 'number') return source.width
  return 0
}

function getSourceHeight(source: TexImageSource): number {
  if ('height' in source && typeof source.height === 'number')
    return source.height
  return 0
}
