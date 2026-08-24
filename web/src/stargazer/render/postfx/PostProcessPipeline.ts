import type {
  BindGroupLayout,
  ColorFormat,
  GfxDevice,
  Pipeline,
  RenderTarget,
  ShaderModule,
  UBuffer,
  VBuffer,
} from '../gfx/GfxDevice'
import type { PostEffect, PostPass, PostPassContext } from './PostEffect'
import { POST_PARAMS_UBO_BINDING } from '../gfx/batchLayout'

/** Attribute location the fullscreen vertex shader forces for `a_pos`. */
const LOC_POS = 0
/** Attribute location for `a_uv`. */
const LOC_UV = 1
/** Bytes per fullscreen-triangle vertex: `vec2` position plus `vec2` uv. */
const VERTEX_STRIDE = 16
/** Sampler unit for the input texture `u_tex`. */
const U_TEX = 0

/** Clip-space corners of the fullscreen triangle. */
const TRI_POS: ReadonlyArray<readonly [number, number]> = [
  [-1, -1],
  [3, -1],
  [-1, 3],
]

/**
 * The fullscreen triangle, interleaved as `[x, y, u, v]` per vertex. It covers
 * the whole `[-1,1]` viewport, with the two off-screen corners clipped. One
 * triangle rather than a quad avoids the diagonal seam that splits `dFdx/dFdy`
 * and hurts texture-cache locality.
 *
 * The uv is carried as an attribute rather than derived from the position in
 * the shader, because the backends disagree on which row of a sampled render
 * target is the top: WebGPU stores row 0 at the top, WebGL at the bottom. A
 * shader deriving `uv = pos * 0.5 + 0.5` therefore samples upside down on
 * WebGPU, which turned every odd-numbered ping-pong pass on its head and left a
 * single enabled effect rendering the whole frame flipped. Baking the flip into
 * three vertices costs nothing per draw and keeps the shaders backend-
 * agnostic.
 *
 * Exported so the orientation contract can be asserted for both backends
 * without a GPU.
 */
export function fullscreenTri(flipV: boolean): Float32Array {
  const out = new Float32Array(TRI_POS.length * 4)
  TRI_POS.forEach(([x, y], i) => {
    out[i * 4] = x
    out[i * 4 + 1] = y
    out[i * 4 + 2] = x * 0.5 + 0.5
    out[i * 4 + 3] = flipV ? 0.5 - y * 0.5 : y * 0.5 + 0.5
  })
  return out
}

/** GPU resources compiled for one {@link PostPass}. */
interface PassGpu {
  shader: ShaderModule
  layout: BindGroupLayout
  paramsUbo: UBuffer | null
  staging: Float32Array | null
  /**
   * Pipeline per target color format (a pass may run into linear or srgb
   * pools).
   */
  pipelines: Map<ColorFormat, Pipeline>
  pending: Set<ColorFormat>
}

/** A pooled render target and whether it is claimed this frame. */
interface PooledTarget {
  key: string
  rt: RenderTarget
  inUse: boolean
}

/**
 * Runs a chain of screen-space {@link PostEffect}s over the composited frame. A
 * `Stage` owns one (lazily, via `stage.postProcess`) and, when
 * {@link PostProcessPipeline.active}, hands it the screen's resolved render
 * target instead of presenting itself. The pipeline runs each enabled pass as a
 * fullscreen render pass, ping-ponging between two pooled single-sample
 * targets, and presents the final result to the canvas.
 *
 * Fullscreen passes run with depth off and **blending disabled** (baked into
 * the pass pipeline). Each pass overwrites every pixel. Pass pipelines compile
 * asynchronously. Until they're ready the pipeline presents the source frame
 * unmodified for a frame or two.
 *
 * @example
 *   stage.postProcess.add(new Vignette({ intensity: 0.6 }))
 *   stage.postProcess.add(new ChromaticAberration({ amount: 0.01 }))
 */
export class PostProcessPipeline {
  readonly #device: GfxDevice
  #effects: PostEffect[] = []

  #vbo: VBuffer | null = null
  #passGpu = new Map<PostPass, PassGpu>()

  #pool: PooledTarget[] = []
  #usedKeys = new Set<string>()

  #time = 0
  readonly #offRestore: () => void

  constructor(device: GfxDevice) {
    this.#device = device
    this.#offRestore = device.onContextRestored(() => this.#onContextRestored())
  }

  /** True when at least one enabled effect has passes to run. */
  get active(): boolean {
    for (const e of this.#effects) {
      if (e.enabled && e.passes.length > 0) return true
    }
    return false
  }

  get effects(): readonly PostEffect[] {
    return this.#effects
  }

  add<T extends PostEffect>(effect: T): T {
    if (!this.#effects.includes(effect)) this.#effects.push(effect)
    return effect
  }

  /**
   * Compile every added effect's pipelines ahead of time, disabled ones
   * included.
   *
   * Enabling an effect switches the stage off the direct-present path and
   * compiles its shaders in the same frame, which is a synchronous stall long
   * enough to read as the screen freezing. Call this when the cost is masked (a
   * scene load, a transition) so the first pulse is just a pulse. The
   * counterpart to `Gfx2D.warmText`, and idempotent: an already-compiled pass
   * is skipped.
   *
   * The color space of the frame is not known until a run, so both are warmed
   * by default. Pass one to halve the work if the surface is known.
   */
  warm(colorSpaces: readonly ColorFormat[] = ['linear', 'srgb']): void {
    this.#ensureVbo()
    for (const effect of this.#effects) {
      for (const pass of effect.passes) {
        for (const cs of colorSpaces) this.#pipelineFor(pass, cs)
      }
    }
  }

  remove(effect: PostEffect): void {
    const i = this.#effects.indexOf(effect)
    if (i < 0) return
    this.#effects.splice(i, 1)
    for (const pass of effect.passes) {
      const gpu = this.#passGpu.get(pass)
      if (gpu) {
        this.#device.deleteShaderModule(gpu.shader)
        if (gpu.paramsUbo) this.#device.deleteUniformBuffer(gpu.paramsUbo)
        this.#passGpu.delete(pass)
      }
    }
  }

  /**
   * Run the effect chain over `source` (the screen's resolved single-sample
   * target) and present to the canvas. No-op when {@link active} is false, falls
   * back to presenting `source` unmodified while any pass pipeline is still
   * compiling.
   */
  run(
    source: RenderTarget,
    opts: { canvasW: number; canvasH: number; dt: number },
  ): void {
    if (!this.active) return
    const device = this.#device
    this.#time += opts.dt
    this.#ensureVbo()

    const w = source.width
    const h = source.height
    const cs = source.colorSpace

    // Compile (or confirm) every enabled pass's pipeline for this color space.
    // If any isn't ready yet, present the source unmodified this frame.
    let ready = true
    for (const effect of this.#effects) {
      if (!effect.enabled) continue
      for (const pass of effect.passes) {
        if (!this.#pipelineFor(pass, cs)) ready = false
      }
    }
    if (!ready) {
      device.present(source, opts.canvasW, opts.canvasH, { filter: 'nearest' })
      return
    }

    this.#usedKeys.clear()
    const ctx: PostPassContext = {
      width: w,
      height: h,
      texelW: 1 / w,
      texelH: 1 / h,
      time: this.#time,
      dt: opts.dt,
    }

    let read = source
    for (const effect of this.#effects) {
      if (!effect.enabled) continue
      for (const pass of effect.passes) {
        const gpu = this.#passGpu.get(pass)!
        const dst = this.#acquire(w, h, cs)
        // Write this pass's params, then bind (input texture + params).
        if (gpu.paramsUbo && gpu.staging && pass.writeParams) {
          gpu.staging.fill(0)
          pass.writeParams(ctx, gpu.staging)
          device.updateUniformBuffer(gpu.paramsUbo, gpu.staging)
        }
        const entries = [
          { binding: U_TEX, resource: { texture: device.colorTexture(read) } },
        ]
        if (gpu.paramsUbo) {
          entries.push({
            binding: POST_PARAMS_UBO_BINDING,
            resource: { uniformBuffer: gpu.paramsUbo } as never,
          })
        }
        const bindGroup = device.createBindGroup(gpu.layout, entries)
        device.beginRenderPass({
          color: { target: dst, loadOp: 'clear', clearColor: [0, 0, 0, 0] },
        })
        device.draw({
          pipeline: gpu.pipelines.get(cs)!,
          vertexBuffers: [{ buffer: this.#vbo!, offset: 0 }],
          bindGroups: [{ group: 0, bindGroup }],
          vertexCount: 3,
        })
        device.endRenderPass()
        if (read !== source) this.#release(read)
        read = dst
      }
    }

    device.present(read, opts.canvasW, opts.canvasH, { filter: 'nearest' })
    if (read !== source) this.#release(read)
    this.#pruneStale()
  }

  destroy(): void {
    this.#offRestore()
    for (const gpu of this.#passGpu.values()) {
      this.#device.deleteShaderModule(gpu.shader)
      if (gpu.paramsUbo) this.#device.deleteUniformBuffer(gpu.paramsUbo)
    }
    this.#passGpu.clear()
    for (const p of this.#pool) this.#device.deleteRenderTarget(p.rt)
    this.#pool.length = 0
    if (this.#vbo) {
      this.#device.deleteBuffer(this.#vbo)
      this.#vbo = null
    }
  }

  // --- internals -------------------------------------------------------------

  #ensureVbo(): void {
    if (this.#vbo) return
    const tri = fullscreenTri(this.#device.ndc.textureTopDown)
    this.#vbo = this.#device.createVertexBuffer(tri.byteLength)
    this.#device.updateBufferSubData(this.#vbo, 0, tri)
  }

  /**
   * Ensure a pass has GPU resources. Return its pipeline for `cs`, or null if
   * still compiling.
   */
  #pipelineFor(pass: PostPass, cs: ColorFormat): Pipeline | null {
    let gpu = this.#passGpu.get(pass)
    if (!gpu) {
      const device = this.#device
      const hasParams = pass.paramsBytes > 0
      const shader = device.createShaderModule({
        glsl: pass.shader.glsl,
        wgsl: pass.shader.wgsl,
        reflection: pass.shader.reflection,
        label: 'postfx',
      })
      const layout = device.createBindGroupLayout(
        hasParams
          ? [
              { binding: U_TEX, type: 'texture-2d' },
              { binding: POST_PARAMS_UBO_BINDING, type: 'uniform-buffer' },
            ]
          : [{ binding: U_TEX, type: 'texture-2d' }],
      )
      gpu = {
        shader,
        layout,
        paramsUbo: hasParams
          ? device.createUniformBuffer(pass.paramsBytes)
          : null,
        staging: hasParams ? new Float32Array(pass.paramsBytes / 4) : null,
        pipelines: new Map(),
        pending: new Set(),
      }
      this.#passGpu.set(pass, gpu)
    }
    const existing = gpu.pipelines.get(cs)
    if (existing) return existing
    if (gpu.pending.has(cs)) return null
    gpu.pending.add(cs)
    const g = gpu
    void this.#device
      .createPipeline({
        shader: g.shader,
        vertexLayout: [
          {
            arrayStride: VERTEX_STRIDE,
            stepMode: 'vertex',
            attributes: [
              { location: LOC_POS, format: 'float32x2', offset: 0 },
              { location: LOC_UV, format: 'float32x2', offset: 8 },
            ],
          },
        ],
        bindGroupLayouts: [g.layout],
        color: { format: cs, blend: 'none' },
        depth: null,
        cull: 'none',
        frontFace: 'ccw',
        primitive: 'triangle-list',
        samples: 1,
        label: 'postfx',
      })
      .then((p) => {
        g.pipelines.set(cs, p)
        g.pending.delete(cs)
      })
    return null
  }

  #acquire(w: number, h: number, colorSpace: ColorFormat): RenderTarget {
    const key = `${w}x${h}:${colorSpace}`
    this.#usedKeys.add(key)
    for (const p of this.#pool) {
      if (!p.inUse && p.key === key) {
        p.inUse = true
        return p.rt
      }
    }
    const rt = this.#device.createRenderTarget({
      width: w,
      height: h,
      samples: 1,
      depth: false,
      colorSpace,
    })
    this.#pool.push({ key, rt, inUse: true })
    return rt
  }

  #release(rt: RenderTarget): void {
    for (const p of this.#pool) {
      if (p.rt === rt) {
        p.inUse = false
        return
      }
    }
  }

  #pruneStale(): void {
    for (let i = this.#pool.length - 1; i >= 0; i--) {
      const p = this.#pool[i]
      p.inUse = false
      if (!this.#usedKeys.has(p.key)) {
        this.#device.deleteRenderTarget(p.rt)
        this.#pool.splice(i, 1)
      }
    }
  }

  #onContextRestored(): void {
    // GPU handles are dead after a loss. Drop references and let the next run
    // rebuild the VBO, shaders/pipelines, and targets lazily.
    this.#vbo = null
    this.#passGpu.clear()
    this.#pool.length = 0
  }
}
