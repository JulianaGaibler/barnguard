/**
 * WebGL2 implementation of `GfxDevice`. Owns the GL context, elides redundant
 * driver calls via minimal per-frame state tracking.
 *
 * Context creation:
 *
 * - `antialias: false`, we own AA (shader-distance).
 * - Premultiplied alpha end-to-end so the compositor doesn't double-multiply.
 * - `UNPACK_COLORSPACE_CONVERSION_WEBGL = NONE` guards against silent sRGB→linear
 *   on `ImageBitmap` / `HTMLImageElement` upload.
 * - Face culling disabled, 2D geometry has mixed winding.
 */

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
  Texture,
  Texture2DOpts,
  TextureUploadOpts,
  UBuffer,
  VBuffer,
  Vao,
} from '../GfxDevice'

// --- concrete backing structs (kept private, exposed as branded handles) ----

interface WebGL2Program extends Program {
  gl: WebGLProgram
  uniformLocations: Map<string, WebGLUniformLocation | null>
  /** Cached `uniform1i` sampler→unit assignments, so a repeat bind skips it. */
  samplerUnits: Map<string, number>
}

interface WebGL2Buffer extends VBuffer {
  gl: WebGLBuffer
  byteSize: number
}

interface WebGL2UniformBuffer extends UBuffer {
  gl: WebGLBuffer
  byteSize: number
}

interface WebGL2IndexBuffer extends IBuffer {
  gl: WebGLBuffer
  byteSize: number
  indexType: IndexType
}

interface WebGL2Texture extends Texture {
  gl: WebGLTexture
  width: number
  height: number
  filter: 'nearest' | 'linear'
  wrap: 'clamp' | 'repeat'
}

interface WebGL2Vao extends Vao {
  gl: WebGLVertexArrayObject
  /** Element width of the captured index buffer, read by `drawElements`. */
  indexType?: IndexType
}

/**
 * Discriminated color attachment. `samples === 1` uses `color` texture,
 * `samples > 1` uses `colorRb` multisample renderbuffer. `samples` is the
 * effective (post-clamp) count so `blitToDefault` picks the right filter
 * without re-querying.
 */
export type WebGL2RenderTarget = RenderTarget & {
  fbo: WebGLFramebuffer
  width: number
  height: number
  /** Effective (post-clamp) sample count. `1` = no MSAA. */
  samples: number
  /** Depth-stencil renderbuffer when `opts.depth`, else absent. */
  depthRb?: WebGLRenderbuffer
} & (
    | { color: WebGL2Texture; colorRb?: undefined }
    | { color?: undefined; colorRb: WebGLRenderbuffer }
  )

// --- device -----------------------------------------------------------------

export class WebGL2Device implements GfxDevice {
  readonly #gl: WebGL2RenderingContext
  readonly #canvas: HTMLCanvasElement

  #_contextLost = false
  readonly #lostCbs = new Set<() => void>()
  readonly #restoredCbs = new Set<() => void>()

  // Cached state, bind lazily so back-to-back identical calls are free.
  #curProgram: WebGL2Program | null = null
  #curVao: WebGL2Vao | null = null
  #curBlend: GfxBlendMode | null = null
  #curFbo: WebGLFramebuffer | null = null
  // 3D-pass render state, cached like the rest so the 3D pass and
  // `resetToBaseline` skip redundant driver calls. Initial values match the
  // constructor's GL setup (depth off, writes on, no culling).
  #curDepthTest = false
  #curDepthWrite = true
  #curCull: CullMode = 'none'
  /** Texture bound per unit, so `setUniformTexture` elides redundant binds. */
  #boundTex: (WebGLTexture | null)[] = []
  /** Currently-bound `ARRAY_BUFFER`, so uploads stop bind/unbinding each call. */
  #boundArrayBuffer: WebGLBuffer | null = null

  /**
   * Per-frame counts of real GL state changes (post-elision). Reset in
   * `beginFrame`; `GpuGfx` copies them into its HUD stats after `endFrame`.
   */
  readonly deviceStats: DeviceStats = {
    programSwitches: 0,
    blendSwitches: 0,
    textureBinds: 0,
  }

  /**
   * Driver's `MAX_TEXTURE_SIZE` cap. Some Intel/Linux drivers report 4096;
   * requests larger than this get clamped in `createTexture2D` /
   * `resizeRenderTarget` with a warn-once so a Retina dev box (7680×4320)
   * degrades to 4096×2304 with GPU upscaling on the blit rather than throwing.
   */
  readonly maxTextureSize: number
  /** Driver's `MAX_SAMPLES`, clamps requested MSAA sample counts. */
  readonly maxSamples: number
  #warnedMaxTextureClamp = false
  #warnedMaxSamplesClamp = false

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
    // 2D content has mixed winding; culling would drop primitives silently.
    gl.disable(gl.CULL_FACE)
    // Depth/stencil are disabled at context creation; ensure they're off in
    // state too so a stray driver default doesn't reject fragments.
    gl.disable(gl.DEPTH_TEST)
    gl.disable(gl.STENCIL_TEST)
    // Blending stays enabled, the mode is set per batch.
    gl.enable(gl.BLEND)

    canvas.addEventListener('webglcontextlost', this.#onLost, false)
    canvas.addEventListener('webglcontextrestored', this.#onRestored, false)
  }

  /**
   * Clamp a requested MSAA sample count to `[1, maxSamples]`; warn once on
   * clamp. Values `< 1` normalize to `1` (no MSAA). Non-power-of-two requests
   * are allowed, drivers pick the closest supported value.
   */
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

  /** Clamp a requested dimension to `maxTextureSize`; warn once on clamp. */
  #clampTextureDim(w: number, h: number): [number, number] {
    const cap = this.maxTextureSize
    if (w <= cap && h <= cap) return [w, h]
    if (!this.#warnedMaxTextureClamp) {
      this.#warnedMaxTextureClamp = true
      console.warn(
        `WebGL2Device: requested texture ${w}×${h} exceeds MAX_TEXTURE_SIZE ${cap}; clamping. Renders continue at the clamped size with GPU upscaling on blit.`,
      )
    }
    return [Math.min(w, cap), Math.min(h, cap)]
  }

  /**
   * Force a context-loss for testing + kiosk field debugging. Uses the
   * `WEBGL_lose_context` extension when available (real browser); falls back to
   * synthesizing the DOM events when the extension is absent (happy-dom tests).
   * No-op when the context is already lost.
   */
  simulateContextLoss(): void {
    if (this.#_contextLost) return
    const ext = this.#gl.getExtension('WEBGL_lose_context') as {
      loseContext(): void
      restoreContext(): void
    } | null
    if (ext) {
      ext.loseContext()
      // Some drivers dispatch synchronously; others don't. Force our
      // handler so state stays consistent for tests.
      this.#onLost(new Event('webglcontextlost'))
    } else {
      this.#onLost(new Event('webglcontextlost'))
    }
  }

  /** Companion to `simulateContextLoss`, restore the context (or fake it). */
  simulateContextRestored(): void {
    if (!this.#_contextLost) return
    const ext = this.#gl.getExtension('WEBGL_lose_context') as {
      loseContext(): void
      restoreContext(): void
    } | null
    if (ext) {
      ext.restoreContext()
    }
    this.#onRestored()
  }

  // --- programs -------------------------------------------------------------

  createProgram(opts: ProgramOpts): Program {
    const gl = this.#gl
    // Enforce the `#version 300 es` first-line rule, a leading blank line or
    // BOM silently downgrades the shader to WebGL1 GLSL, which uses different
    // I/O syntax (attribute/varying/texture2D/gl_FragColor).
    if (!opts.vertexSrc.startsWith('#version 300 es\n')) {
      throw new Error(
        'WebGL2Device.createProgram: vertex shader must start with `#version 300 es\\n`',
      )
    }
    if (!opts.fragmentSrc.startsWith('#version 300 es\n')) {
      throw new Error(
        'WebGL2Device.createProgram: fragment shader must start with `#version 300 es\\n`',
      )
    }

    const vs = compileShader(gl, gl.VERTEX_SHADER, opts.vertexSrc)
    const fs = compileShader(gl, gl.FRAGMENT_SHADER, opts.fragmentSrc)
    const program = gl.createProgram()
    if (!program)
      throw new Error(
        'WebGL2Device.createProgram: gl.createProgram returned null',
      )
    gl.attachShader(program, vs)
    gl.attachShader(program, fs)
    // Force our attribute locations BEFORE link so `AttribBinding.location`
    // values line up regardless of how the driver would otherwise assign them.
    for (const name of Object.keys(opts.attribs)) {
      gl.bindAttribLocation(program, opts.attribs[name], name)
    }
    gl.linkProgram(program)
    if (!gl.getProgramParameter(program, gl.LINK_STATUS)) {
      const info = gl.getProgramInfoLog(program) ?? '<no info log>'
      gl.deleteProgram(program)
      gl.deleteShader(vs)
      gl.deleteShader(fs)
      throw new Error(`WebGL2Device.createProgram: link failed:\n${info}`)
    }
    // Individual shaders can be detached + deleted after link.
    gl.detachShader(program, vs)
    gl.detachShader(program, fs)
    gl.deleteShader(vs)
    gl.deleteShader(fs)
    // Point each declared uniform block at its binding index, so a UBO bound
    // there with `bindUniformBufferBase` feeds this program.
    if (opts.uniformBlocks) {
      for (const name of Object.keys(opts.uniformBlocks)) {
        const idx = gl.getUniformBlockIndex(program, name)
        if (idx !== gl.INVALID_INDEX) {
          gl.uniformBlockBinding(program, idx, opts.uniformBlocks[name])
        }
      }
    }
    const wrapped: WebGL2Program = {
      __gfxProgram: undefined as never,
      gl: program,
      uniformLocations: new Map(),
      samplerUnits: new Map(),
    }
    return wrapped
  }

  deleteProgram(p: Program): void {
    const w = p as WebGL2Program
    if (this.#curProgram === w) this.#curProgram = null
    this.#gl.deleteProgram(w.gl)
  }

  useProgram(p: Program): void {
    const w = p as WebGL2Program
    if (this.#curProgram === w) return
    this.#gl.useProgram(w.gl)
    this.#curProgram = w
    this.deviceStats.programSwitches++
  }

  // --- uniforms -------------------------------------------------------------

  #locOf(p: WebGL2Program, name: string): WebGLUniformLocation | null {
    let loc = p.uniformLocations.get(name)
    if (loc === undefined) {
      loc = this.#gl.getUniformLocation(p.gl, name)
      p.uniformLocations.set(name, loc)
    }
    return loc
  }

  setUniform1i(p: Program, name: string, v: number): void {
    const w = p as WebGL2Program
    const loc = this.#locOf(w, name)
    if (loc !== null) this.#gl.uniform1i(loc, v)
  }

  setUniform1f(p: Program, name: string, v: number): void {
    const w = p as WebGL2Program
    const loc = this.#locOf(w, name)
    if (loc !== null) this.#gl.uniform1f(loc, v)
  }

  setUniform4f(
    p: Program,
    name: string,
    x: number,
    y: number,
    z: number,
    w: number,
  ): void {
    const prog = p as WebGL2Program
    const loc = this.#locOf(prog, name)
    if (loc !== null) this.#gl.uniform4f(loc, x, y, z, w)
  }

  setUniformMat3(p: Program, name: string, m: Float32Array): void {
    const w = p as WebGL2Program
    const loc = this.#locOf(w, name)
    if (loc !== null) this.#gl.uniformMatrix3fv(loc, false, m)
  }

  setUniformMat4(p: Program, name: string, m: Float32Array): void {
    const w = p as WebGL2Program
    const loc = this.#locOf(w, name)
    if (loc !== null) this.#gl.uniformMatrix4fv(loc, false, m)
  }

  setUniformTexture(
    p: Program,
    name: string,
    tex: Texture,
    unit: number,
  ): void {
    const gl = this.#gl
    const t = tex as WebGL2Texture
    // Bind only when the unit doesn't already hold this texture. Per-unit
    // tracking is correct across cohabiting samplers (atlas on 0, mask on 1).
    if (this.#boundTex[unit] !== t.gl) {
      gl.activeTexture(gl.TEXTURE0 + unit)
      gl.bindTexture(gl.TEXTURE_2D, t.gl)
      this.#boundTex[unit] = t.gl
      this.deviceStats.textureBinds++
    }
    // The sampler→unit uniform almost never changes for a given (program, name);
    // set it once and cache so repeats skip the `uniform1i`.
    const w = p as WebGL2Program
    if (w.samplerUnits.get(name) !== unit) {
      const loc = this.#locOf(w, name)
      if (loc !== null) gl.uniform1i(loc, unit)
      w.samplerUnits.set(name, unit)
    }
  }

  // --- buffers --------------------------------------------------------------

  /**
   * Bind an `ARRAY_BUFFER` only when it isn't already current. The
   * `ARRAY_BUFFER` binding is global (not VAO state), so caching it across
   * calls is safe; the per-attribute pointers a VAO captures are set explicitly
   * at `createVao` / `drawInstancedRange` time regardless of this binding.
   */
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
    // DYNAMIC_DRAW, we rewrite the whole buffer every frame.
    gl.bufferData(gl.ARRAY_BUFFER, byteSize, gl.DYNAMIC_DRAW)
    return {
      __gfxBuffer: undefined as never,
      gl: buf,
      byteSize,
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
    // WebGL2 signature: bufferSubData(target, dstOffset, srcData, srcOffset, length).
    // `srcOffset` and `length` are in ELEMENTS of the view's type, not bytes,
    // so we normalize to a `Uint8Array` slice-free view over the same buffer.
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
    // Reallocate storage at the same size; detaches whatever an in-flight draw
    // is still reading so the append cursor can safely restart at 0.
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

  updateUniformBuffer(buf: UBuffer, data: Float32Array): void {
    const gl = this.#gl
    const b = buf as WebGL2UniformBuffer
    gl.bindBuffer(gl.UNIFORM_BUFFER, b.gl)
    gl.bufferSubData(gl.UNIFORM_BUFFER, 0, data)
    gl.bindBuffer(gl.UNIFORM_BUFFER, null)
  }

  bindUniformBufferBase(buf: UBuffer, index: number): void {
    const b = buf as WebGL2UniformBuffer
    this.#gl.bindBufferBase(this.#gl.UNIFORM_BUFFER, index, b.gl)
  }

  deleteUniformBuffer(buf: UBuffer): void {
    this.#gl.deleteBuffer((buf as WebGL2UniformBuffer).gl)
  }

  // --- index buffers --------------------------------------------------------

  /**
   * The `ELEMENT_ARRAY_BUFFER` binding is captured by whichever VAO is bound,
   * so every index-buffer op resets to the default VAO first to avoid
   * corrupting a program VAO's captured element binding.
   */
  #detachVaoForElementOp(): void {
    if (this.#curVao !== null) {
      this.#gl.bindVertexArray(null)
      this.#curVao = null
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
    // STATIC_DRAW — retained geometry uploads once.
    gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, buf)
    gl.bufferData(gl.ELEMENT_ARRAY_BUFFER, byteSize, gl.STATIC_DRAW)
    gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, null)
    return {
      __gfxIndexBuffer: undefined as never,
      gl: buf,
      byteSize,
      indexType: type,
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
    gl.bindTexture(gl.TEXTURE_2D, tex)
    // Allocate storage. Mutable, texImage2D can reallocate on resize.
    gl.texImage2D(
      gl.TEXTURE_2D,
      0,
      gl.RGBA8,
      clampedW,
      clampedH,
      0,
      gl.RGBA,
      gl.UNSIGNED_BYTE,
      null,
    )
    const filter = opts.filter ?? 'linear'
    const wrap = opts.wrap ?? 'clamp'
    gl.texParameteri(
      gl.TEXTURE_2D,
      gl.TEXTURE_MIN_FILTER,
      filter === 'linear' ? gl.LINEAR : gl.NEAREST,
    )
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
    gl.bindTexture(gl.TEXTURE_2D, null)
    return {
      __gfxTexture: undefined as never,
      gl: tex,
      width: clampedW,
      height: clampedH,
      filter,
      wrap,
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
  }

  updateTexture2D(
    tex: Texture,
    source: TexImageSource | null,
    opts: TextureUploadOpts = {},
  ): void {
    const gl = this.#gl
    const t = tex as WebGL2Texture
    if (source === null) return // storage already allocated at create time
    gl.bindTexture(gl.TEXTURE_2D, t.gl)
    // Per-call unpack flags, safer than sticky state; the compositor's
    // colorspace conversion is the one that bites hardest on Linux drivers.
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
        gl.RGBA8,
        gl.RGBA,
        gl.UNSIGNED_BYTE,
        source,
      )
      // Sync branded metadata. Texture is readonly at the interface layer, so
      // we mutate the concrete struct behind the cast.
      ;(t as { width: number }).width = w
      ;(t as { height: number }).height = h
    }
    // Reset flip so subsequent uploads don't inherit it accidentally.
    gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, 0)
    gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, 0)
    gl.bindTexture(gl.TEXTURE_2D, null)
  }

  deleteTexture(tex: Texture): void {
    const t = tex as WebGL2Texture
    // Drop the deleted handle from the unit cache so a later bind of a
    // driver-recycled handle can't be wrongly elided.
    for (let u = 0; u < this.#boundTex.length; u++) {
      if (this.#boundTex[u] === t.gl) this.#boundTex[u] = null
    }
    this.#gl.deleteTexture(t.gl)
  }

  // --- vertex arrays --------------------------------------------------------

  createVao(
    program: Program,
    attribs: AttribBinding[],
    indexBuffer?: IBuffer,
  ): Vao {
    const gl = this.#gl
    // Program isn't strictly needed for VAO creation in WebGL2 (attribute
    // locations are already bound), but we keep the parameter for API
    // symmetry with a future WebGPU pipeline layout.
    void program
    const vao = gl.createVertexArray()
    if (!vao)
      throw new Error('WebGL2Device.createVao: createVertexArray returned null')
    gl.bindVertexArray(vao)
    for (const a of attribs) {
      const b = a.buffer as WebGL2Buffer
      this.#bindArrayBuffer(b.gl)
      gl.enableVertexAttribArray(a.location)
      const type = attribGlType(gl, a.type)
      gl.vertexAttribPointer(
        a.location,
        a.size,
        type,
        a.normalized,
        a.stride,
        a.offset,
      )
      gl.vertexAttribDivisor(a.location, a.divisor)
    }
    // Capture the element buffer into this VAO (VAO state). Bound while the VAO
    // is active, so it belongs to this VAO and no other.
    if (indexBuffer) {
      gl.bindBuffer(
        gl.ELEMENT_ARRAY_BUFFER,
        (indexBuffer as WebGL2IndexBuffer).gl,
      )
    }
    gl.bindVertexArray(null)
    // `#curVao` is now stale (we bound then unbound); the next `bindVao` must
    // re-bind. `bindVertexArray(null)` also cleared the element binding on the
    // default VAO, so no leak.
    this.#curVao = null
    return {
      __gfxVao: undefined as never,
      gl: vao,
      indexType: indexBuffer
        ? (indexBuffer as WebGL2IndexBuffer).indexType
        : undefined,
    } as WebGL2Vao
  }

  bindVao(vao: Vao): void {
    const w = vao as WebGL2Vao
    if (this.#curVao === w) return
    this.#gl.bindVertexArray(w.gl)
    this.#curVao = w
  }

  deleteVao(vao: Vao): void {
    const w = vao as WebGL2Vao
    if (this.#curVao === w) this.#curVao = null
    this.#gl.deleteVertexArray(w.gl)
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
    if (samples > 1) {
      // Multisample renderbuffer path, gets us hardware coverage AA on
      // polygon edges. Cannot be sampled as a texture; `blitToDefault`
      // performs the resolve.
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
      } as WebGL2RenderTarget
    } else {
      // Single-sample texture path, usable both for `samples: 1` opt-outs and
      // for a sampled resolve target (a `Viewport2DNode` reads it back in the
      // 3D pass).
      const color = this.createTexture2D({
        width: clampedW,
        height: clampedH,
        filter: 'linear',
        wrap: 'clamp',
      }) as WebGL2Texture
      if (opts.colorSpace === 'srgb') {
        // Re-specify storage as sRGB so a shader sampling this target decodes
        // to linear and the gamma matches the on-screen surface.
        gl.bindTexture(gl.TEXTURE_2D, color.gl)
        gl.texImage2D(
          gl.TEXTURE_2D,
          0,
          gl.SRGB8_ALPHA8,
          clampedW,
          clampedH,
          0,
          gl.RGBA,
          gl.UNSIGNED_BYTE,
          null,
        )
        gl.bindTexture(gl.TEXTURE_2D, null)
      }
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
      } as WebGL2RenderTarget
    }
    // Optional depth-stencil attachment (3D passes; 2D leaves it off). Sample
    // count matches the color attachment so the FBO is complete.
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
      // Multisample renderbuffer, renderbufferStorageMultisample
      // re-allocates in place, so the FBO attachment stays valid.
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
      // Texture attachment, `texImage2D` mutates size on the existing
      // texture object; FBO attachment stays valid.
      gl.bindTexture(gl.TEXTURE_2D, r.color.gl)
      gl.texImage2D(
        gl.TEXTURE_2D,
        0,
        gl.RGBA8,
        clampedW,
        clampedH,
        0,
        gl.RGBA,
        gl.UNSIGNED_BYTE,
        null,
      )
      gl.bindTexture(gl.TEXTURE_2D, null)
      ;(r.color as { width: number }).width = clampedW
      ;(r.color as { height: number }).height = clampedH
    }
    // Depth-stencil renderbuffer resizes in place alongside the color buffer.
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

  // --- frame lifecycle ------------------------------------------------------

  beginFrame(opts: BeginFrameOpts): void {
    const gl = this.#gl
    // Reset the real-GL-change counters for this frame; the binding caches
    // themselves persist (a texture bound last frame is still bound).
    this.deviceStats.programSwitches = 0
    this.deviceStats.blendSwitches = 0
    this.deviceStats.textureBinds = 0
    const r = opts.target as WebGL2RenderTarget
    if (this.#curFbo !== r.fbo) {
      gl.bindFramebuffer(gl.FRAMEBUFFER, r.fbo)
      this.#curFbo = r.fbo
    }
    gl.viewport(0, 0, r.width, r.height)
    let mask = 0
    if (opts.clearColor) {
      const [cr, cg, cb, ca] = opts.clearColor
      // clearColor takes premultiplied color for premultiplied surfaces.
      gl.clearColor(cr * ca, cg * ca, cb * ca, ca)
      mask |= gl.COLOR_BUFFER_BIT
    }
    if (opts.clearDepth) {
      // Depth writes must be enabled for the clear to reach the buffer.
      this.setDepthWrite(true)
      mask |= gl.DEPTH_BUFFER_BIT
    }
    if (mask !== 0) gl.clear(mask)
  }

  endFrame(): void {
    // No device-level end work. GpuGfx flushes then calls blitToDefault.
  }

  // --- state ---------------------------------------------------------------

  setBlend(mode: GfxBlendMode): void {
    if (this.#curBlend === mode) return
    const gl = this.#gl
    if (mode === 'source-over') {
      gl.blendFuncSeparate(
        gl.ONE,
        gl.ONE_MINUS_SRC_ALPHA,
        gl.ONE,
        gl.ONE_MINUS_SRC_ALPHA,
      )
    } else {
      // 'lighter', additive; both surface and source are premultiplied.
      gl.blendFunc(gl.ONE, gl.ONE)
    }
    this.#curBlend = mode
    this.deviceStats.blendSwitches++
  }

  setDepthTest(enabled: boolean): void {
    if (this.#curDepthTest === enabled) return
    const gl = this.#gl
    if (enabled) gl.enable(gl.DEPTH_TEST)
    else gl.disable(gl.DEPTH_TEST)
    this.#curDepthTest = enabled
  }

  setDepthWrite(enabled: boolean): void {
    if (this.#curDepthWrite === enabled) return
    this.#gl.depthMask(enabled)
    this.#curDepthWrite = enabled
  }

  setCullFace(mode: CullMode): void {
    if (this.#curCull === mode) return
    const gl = this.#gl
    if (mode === 'none') {
      gl.disable(gl.CULL_FACE)
    } else {
      gl.enable(gl.CULL_FACE)
      gl.cullFace(mode === 'back' ? gl.BACK : gl.FRONT)
    }
    this.#curCull = mode
  }

  resetToBaseline(): void {
    this.setDepthTest(false)
    this.setDepthWrite(true)
    this.setCullFace('none')
    this.setBlend('source-over')
  }

  // --- draw -----------------------------------------------------------------

  drawArrays(first: number, count: number): void {
    this.#gl.drawArrays(this.#gl.TRIANGLES, first, count)
  }

  drawLines(first: number, count: number): void {
    this.#gl.drawArrays(this.#gl.LINES, first, count)
  }

  drawElements(count: number, byteOffset: number): void {
    const gl = this.#gl
    const glType =
      this.#curVao?.indexType === 'u32' ? gl.UNSIGNED_INT : gl.UNSIGNED_SHORT
    gl.drawElements(gl.TRIANGLES, count, glType, byteOffset)
  }

  drawArraysInstanced(
    first: number,
    count: number,
    instanceCount: number,
  ): void {
    this.#gl.drawArraysInstanced(
      this.#gl.TRIANGLES,
      first,
      count,
      instanceCount,
    )
  }

  drawInstancedRange(
    vao: Vao,
    instanceBuffer: VBuffer,
    instanceAttribs: readonly AttribBinding[],
    baseByteOffset: number,
    vertCount: number,
    instanceCount: number,
  ): void {
    const gl = this.#gl
    this.bindVao(vao)
    // Re-point each per-instance attribute to the run's base offset. This
    // mutates the bound VAO's captured pointer state, which is safe because
    // every run re-points before drawing, so no stale offset can leak forward.
    this.#bindArrayBuffer((instanceBuffer as WebGL2Buffer).gl)
    for (const a of instanceAttribs) {
      gl.vertexAttribPointer(
        a.location,
        a.size,
        attribGlType(gl, a.type),
        a.normalized,
        a.stride,
        baseByteOffset + a.offset,
      )
    }
    gl.drawArraysInstanced(gl.TRIANGLES, 0, vertCount, instanceCount)
  }

  // --- blit -----------------------------------------------------------------

  blitToDefault(
    source: RenderTarget,
    dstWidth: number,
    dstHeight: number,
    opts: BlitOpts = {},
  ): void {
    const gl = this.#gl
    const r = source as WebGL2RenderTarget
    // WebGL2 rule: resolving a multisampled source via blitFramebuffer
    // REQUIRES `gl.NEAREST` filter AND identical src/dst bounds. LINEAR
    // throws `INVALID_OPERATION`. Under GPU we force DynRes off (Phase 4),
    // so the FBO is 1:1 with the canvas drawing buffer and the identical-
    // bounds rule is satisfied by construction.
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
    // Rebind the offscreen FBO as the DRAW target so further beginFrame calls
    // don't accidentally target the default framebuffer.
    gl.bindFramebuffer(gl.FRAMEBUFFER, null)
    this.#curFbo = null
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
    // Drop cached state, the GL objects it referenced are gone.
    this.#curProgram = null
    this.#curVao = null
    this.#curBlend = null
    this.#curFbo = null
    this.#boundTex = []
    this.#boundArrayBuffer = null
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
    // Force-release the GL context so it stops counting against the per-page
    // live-context cap (~8-16). `loseContext()` reclaims the context and every
    // GL object it owns (programs, buffers, VAOs, FBOs, textures) atomically,
    // so no per-object `gl.delete*` sweep is needed. The extension is absent
    // under happy-dom and in the rare browser without it; skip quietly there.
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

function attribGlType(
  gl: WebGL2RenderingContext,
  t: 'float' | 'unorm8' | 'uint8',
): number {
  if (t === 'float') return gl.FLOAT
  return gl.UNSIGNED_BYTE
}

function getSourceWidth(source: TexImageSource): number {
  if ('width' in source && typeof source.width === 'number') return source.width
  // VideoFrame etc., treat as unknown; caller must have provided a matching-
  // size source. Fall through to 0 which forces a reallocation branch above.
  return 0
}

function getSourceHeight(source: TexImageSource): number {
  if ('height' in source && typeof source.height === 'number')
    return source.height
  return 0
}
