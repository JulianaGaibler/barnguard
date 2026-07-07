/**
 * `WebGL2Device`, the WebGL2 implementation of `GfxDevice`. Owns the GL
 * context, tracks minimal per-frame state (program/VAO/blend) to elide
 * redundant driver calls, and wraps the awkward WebGL bits (attribute binding,
 * texture unpack flags, FBO blit, context loss) behind the `GfxDevice` seam so
 * `GpuGfx`, and, later, a WebGPU sibling, stays blissfully unaware.
 *
 * Context creation notes (matched to the port plan):
 *
 * - `antialias: false`, we own AA (shader-distance in Phase 2), never MSAA.
 * - `alpha: true`, `premultipliedAlpha: true`, the whole pipeline runs
 *   premultiplied so the compositor doesn't apply a hidden extra multiply.
 * - `UNPACK_COLORSPACE_CONVERSION_WEBGL = NONE` on every texture upload. * guards
 *   against sRGB→linear conversions some drivers apply silently when uploading
 *   `ImageBitmap` / `HTMLImageElement`.
 * - Face culling stays disabled (WebGL2 default), our 2D geometry has mixed
 *   winding.
 */

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
} from '../GfxDevice'

// --- concrete backing structs (kept private, exposed as branded handles) ----

interface WebGL2Program extends Program {
  gl: WebGLProgram
  uniformLocations: Map<string, WebGLUniformLocation | null>
}

interface WebGL2Buffer extends VBuffer {
  gl: WebGLBuffer
  byteSize: number
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
}

/**
 * Discriminated union of color-attachment shapes. `samples === 1` uses a
 * regular texture attachment (`color`); `samples > 1` uses a multisample
 * renderbuffer (`colorRb`). Mutually exclusive, only one is set. The `samples`
 * field carries the effective (post-clamp) sample count so `blitToDefault` can
 * pick the right filter (NEAREST for multisample resolve, LINEAR otherwise)
 * without re-querying.
 */
export type WebGL2RenderTarget = RenderTarget & {
  fbo: WebGLFramebuffer
  width: number
  height: number
  /** Effective (post-clamp) sample count. `1` = no MSAA. */
  samples: number
} & (
    | { color: WebGL2Texture; colorRb?: undefined }
    | { color?: undefined; colorRb: WebGLRenderbuffer }
  )

// --- device -----------------------------------------------------------------

export class WebGL2Device implements GfxDevice {
  private readonly gl: WebGL2RenderingContext
  private readonly canvas: HTMLCanvasElement

  private _contextLost = false
  private readonly lostCbs = new Set<() => void>()
  private readonly restoredCbs = new Set<() => void>()

  // Cached state, bind lazily so back-to-back identical calls are free.
  private curProgram: WebGL2Program | null = null
  private curVao: WebGL2Vao | null = null
  private curBlend: GfxBlendMode | null = null
  private curFbo: WebGLFramebuffer | null = null

  /**
   * Driver's `MAX_TEXTURE_SIZE` cap. Some Intel/Linux drivers report 4096;
   * requests larger than this get clamped in `createTexture2D` /
   * `resizeRenderTarget` with a warn-once so a Retina dev box (7680×4320)
   * degrades to 4096×2304 with GPU upscaling on the blit rather than throwing.
   */
  readonly maxTextureSize: number
  /** Driver's `MAX_SAMPLES`, clamps requested MSAA sample counts. */
  readonly maxSamples: number
  private warnedMaxTextureClamp = false
  private warnedMaxSamplesClamp = false

  constructor(canvas: HTMLCanvasElement) {
    this.canvas = canvas
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
    this.gl = gl
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

    canvas.addEventListener('webglcontextlost', this.onLost, false)
    canvas.addEventListener('webglcontextrestored', this.onRestored, false)
  }

  /**
   * Clamp a requested MSAA sample count to `[1, maxSamples]`; warn once on
   * clamp. Values `< 1` normalize to `1` (no MSAA). Non-power-of-two requests
   * are allowed, drivers pick the closest supported value.
   */
  private clampSamples(samples: number): number {
    if (samples <= 1) return 1
    if (samples <= this.maxSamples) return Math.floor(samples)
    if (!this.warnedMaxSamplesClamp) {
      this.warnedMaxSamplesClamp = true
      console.warn(
        `WebGL2Device: requested MSAA ${samples}× exceeds driver MAX_SAMPLES ${this.maxSamples}; clamping.`,
      )
    }
    return this.maxSamples
  }

  /** Clamp a requested dimension to `maxTextureSize`; warn once on clamp. */
  private clampTextureDim(w: number, h: number): [number, number] {
    const cap = this.maxTextureSize
    if (w <= cap && h <= cap) return [w, h]
    if (!this.warnedMaxTextureClamp) {
      this.warnedMaxTextureClamp = true
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
    if (this._contextLost) return
    const ext = this.gl.getExtension('WEBGL_lose_context') as {
      loseContext(): void
      restoreContext(): void
    } | null
    if (ext) {
      ext.loseContext()
      // Some drivers dispatch synchronously; others don't. Force our
      // handler so state stays consistent for tests.
      this.onLost(new Event('webglcontextlost'))
    } else {
      this.onLost(new Event('webglcontextlost'))
    }
  }

  /** Companion to `simulateContextLoss`, restore the context (or fake it). */
  simulateContextRestored(): void {
    if (!this._contextLost) return
    const ext = this.gl.getExtension('WEBGL_lose_context') as {
      loseContext(): void
      restoreContext(): void
    } | null
    if (ext) {
      ext.restoreContext()
    }
    this.onRestored()
  }

  // --- programs -------------------------------------------------------------

  createProgram(opts: ProgramOpts): Program {
    const gl = this.gl
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
    const wrapped: WebGL2Program = {
      __gfxProgram: undefined as never,
      gl: program,
      uniformLocations: new Map(),
    }
    return wrapped
  }

  deleteProgram(p: Program): void {
    const w = p as WebGL2Program
    if (this.curProgram === w) this.curProgram = null
    this.gl.deleteProgram(w.gl)
  }

  useProgram(p: Program): void {
    const w = p as WebGL2Program
    if (this.curProgram === w) return
    this.gl.useProgram(w.gl)
    this.curProgram = w
  }

  // --- uniforms -------------------------------------------------------------

  private locOf(p: WebGL2Program, name: string): WebGLUniformLocation | null {
    let loc = p.uniformLocations.get(name)
    if (loc === undefined) {
      loc = this.gl.getUniformLocation(p.gl, name)
      p.uniformLocations.set(name, loc)
    }
    return loc
  }

  setUniform1i(p: Program, name: string, v: number): void {
    const w = p as WebGL2Program
    const loc = this.locOf(w, name)
    if (loc !== null) this.gl.uniform1i(loc, v)
  }

  setUniform1f(p: Program, name: string, v: number): void {
    const w = p as WebGL2Program
    const loc = this.locOf(w, name)
    if (loc !== null) this.gl.uniform1f(loc, v)
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
    const loc = this.locOf(prog, name)
    if (loc !== null) this.gl.uniform4f(loc, x, y, z, w)
  }

  setUniformMat3(p: Program, name: string, m: Float32Array): void {
    const w = p as WebGL2Program
    const loc = this.locOf(w, name)
    if (loc !== null) this.gl.uniformMatrix3fv(loc, false, m)
  }

  setUniformTexture(
    p: Program,
    name: string,
    tex: Texture,
    unit: number,
  ): void {
    const gl = this.gl
    const t = tex as WebGL2Texture
    // Explicit, never rely on the TEXTURE0 default; a Phase-3 atlas + static
    // map cohabit and would otherwise stomp each other.
    gl.activeTexture(gl.TEXTURE0 + unit)
    gl.bindTexture(gl.TEXTURE_2D, t.gl)
    const w = p as WebGL2Program
    const loc = this.locOf(w, name)
    if (loc !== null) gl.uniform1i(loc, unit)
  }

  // --- buffers --------------------------------------------------------------

  createVertexBuffer(byteSize: number): VBuffer {
    const gl = this.gl
    const buf = gl.createBuffer()
    if (!buf)
      throw new Error(
        'WebGL2Device.createVertexBuffer: createBuffer returned null',
      )
    gl.bindBuffer(gl.ARRAY_BUFFER, buf)
    // DYNAMIC_DRAW, we rewrite the whole buffer every frame.
    gl.bufferData(gl.ARRAY_BUFFER, byteSize, gl.DYNAMIC_DRAW)
    // Unbind so callers don't accidentally poison VAO state.
    gl.bindBuffer(gl.ARRAY_BUFFER, null)
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
    const gl = this.gl
    const b = buf as WebGL2Buffer
    gl.bindBuffer(gl.ARRAY_BUFFER, b.gl)
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
    gl.bindBuffer(gl.ARRAY_BUFFER, null)
  }

  deleteBuffer(buf: VBuffer): void {
    this.gl.deleteBuffer((buf as WebGL2Buffer).gl)
  }

  // --- textures -------------------------------------------------------------

  createTexture2D(opts: Texture2DOpts): Texture {
    const gl = this.gl
    const tex = gl.createTexture()
    if (!tex)
      throw new Error(
        'WebGL2Device.createTexture2D: createTexture returned null',
      )
    const [clampedW, clampedH] = this.clampTextureDim(opts.width, opts.height)
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
    const gl = this.gl
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
    const gl = this.gl
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
    this.gl.deleteTexture((tex as WebGL2Texture).gl)
  }

  // --- vertex arrays --------------------------------------------------------

  createVao(program: Program, attribs: AttribBinding[]): Vao {
    const gl = this.gl
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
      gl.bindBuffer(gl.ARRAY_BUFFER, b.gl)
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
    // Unbind. VAO captures the state above; the current ARRAY_BUFFER binding
    // is NOT part of VAO state, so leaving it bound would leak to callers.
    gl.bindBuffer(gl.ARRAY_BUFFER, null)
    gl.bindVertexArray(null)
    return { __gfxVao: undefined as never, gl: vao } as WebGL2Vao
  }

  bindVao(vao: Vao): void {
    const w = vao as WebGL2Vao
    if (this.curVao === w) return
    this.gl.bindVertexArray(w.gl)
    this.curVao = w
  }

  deleteVao(vao: Vao): void {
    const w = vao as WebGL2Vao
    if (this.curVao === w) this.curVao = null
    this.gl.deleteVertexArray(w.gl)
  }

  // --- render targets -------------------------------------------------------

  createRenderTarget(opts: RenderTargetOpts): RenderTarget {
    const gl = this.gl
    const samples = this.clampSamples(opts.samples ?? 1)
    const fbo = gl.createFramebuffer()
    if (!fbo)
      throw new Error(
        'WebGL2Device.createRenderTarget: createFramebuffer returned null',
      )
    const [clampedW, clampedH] = this.clampTextureDim(opts.width, opts.height)

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
      // Single-sample texture path, same as the pre-MSAA implementation.
      // Kept alive both for `samples: 1` opt-outs and for the (future)
      // resolve-target case where callers need to sample the target.
      const color = this.createTexture2D({
        width: clampedW,
        height: clampedH,
        filter: 'linear',
        wrap: 'clamp',
      }) as WebGL2Texture
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
    const gl = this.gl
    const r = rt as WebGL2RenderTarget
    const [clampedW, clampedH] = this.clampTextureDim(width, height)
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
    ;(r as { width: number }).width = clampedW
    ;(r as { height: number }).height = clampedH
  }

  deleteRenderTarget(rt: RenderTarget): void {
    const r = rt as WebGL2RenderTarget
    this.gl.deleteFramebuffer(r.fbo)
    if (r.colorRb !== undefined) {
      this.gl.deleteRenderbuffer(r.colorRb)
    } else if (r.color !== undefined) {
      this.deleteTexture(r.color)
    }
  }

  // --- frame lifecycle ------------------------------------------------------

  beginFrame(opts: BeginFrameOpts): void {
    const gl = this.gl
    const r = opts.target as WebGL2RenderTarget
    if (this.curFbo !== r.fbo) {
      gl.bindFramebuffer(gl.FRAMEBUFFER, r.fbo)
      this.curFbo = r.fbo
    }
    gl.viewport(0, 0, r.width, r.height)
    if (opts.clearColor) {
      const [cr, cg, cb, ca] = opts.clearColor
      // clearColor takes premultiplied color for premultiplied surfaces.
      gl.clearColor(cr * ca, cg * ca, cb * ca, ca)
      gl.clear(gl.COLOR_BUFFER_BIT)
    }
  }

  endFrame(): void {
    // No device-level end work. GpuGfx flushes then calls blitToDefault.
  }

  // --- state ---------------------------------------------------------------

  setBlend(mode: GfxBlendMode): void {
    if (this.curBlend === mode) return
    const gl = this.gl
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
    this.curBlend = mode
  }

  // --- draw -----------------------------------------------------------------

  drawArrays(first: number, count: number): void {
    this.gl.drawArrays(this.gl.TRIANGLES, first, count)
  }

  drawArraysInstanced(
    first: number,
    count: number,
    instanceCount: number,
  ): void {
    this.gl.drawArraysInstanced(this.gl.TRIANGLES, first, count, instanceCount)
  }

  // --- blit -----------------------------------------------------------------

  blitToDefault(
    source: RenderTarget,
    dstWidth: number,
    dstHeight: number,
    opts: BlitOpts = {},
  ): void {
    const gl = this.gl
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
    this.curFbo = null
  }

  // --- context loss ---------------------------------------------------------

  isContextLost(): boolean {
    return this._contextLost || this.gl.isContextLost()
  }

  onContextLost(cb: () => void): () => void {
    this.lostCbs.add(cb)
    return () => this.lostCbs.delete(cb)
  }

  onContextRestored(cb: () => void): () => void {
    this.restoredCbs.add(cb)
    return () => this.restoredCbs.delete(cb)
  }

  private onLost = (e: Event): void => {
    e.preventDefault()
    this._contextLost = true
    // Drop cached state, the GL objects it referenced are gone.
    this.curProgram = null
    this.curVao = null
    this.curBlend = null
    this.curFbo = null
    for (const cb of this.lostCbs) cb()
  }

  private onRestored = (): void => {
    this._contextLost = false
    for (const cb of this.restoredCbs) cb()
  }

  destroy(): void {
    this.canvas.removeEventListener('webglcontextlost', this.onLost, false)
    this.canvas.removeEventListener(
      'webglcontextrestored',
      this.onRestored,
      false,
    )
    this.lostCbs.clear()
    this.restoredCbs.clear()
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
