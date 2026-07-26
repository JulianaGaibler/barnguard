import type {
  GfxDevice,
  Program,
  RenderTarget,
  Texture,
  VBuffer,
  Vao,
} from '../gfx/GfxDevice'
import type { PostEffect, PostPass, PostPassContext } from './PostEffect'
import fullscreenVertSrc from './shaders/fullscreen.vert.glsl?raw'

/** Attribute location the fullscreen vertex shader forces for `a_pos`. */
const LOC_POS = 0

/**
 * Clip-space fullscreen triangle: three vertices whose triangle covers the
 * whole `[-1,1]` viewport (the two off-screen corners are clipped). One
 * triangle rather than a quad avoids the diagonal seam that splits `dFdx/dFdy`
 * and hurts texture-cache locality.
 */
const FULLSCREEN_TRI = new Float32Array([-1, -1, 3, -1, -1, 3])

/** GPU handles compiled for one {@link PostPass}. */
interface PassGpu {
  program: Program
  vao: Vao
}

/** A pooled render target and whether it is claimed this frame. */
interface PooledTarget {
  key: string
  rt: RenderTarget
  inUse: boolean
}

/**
 * Runs a chain of screen-space {@link PostEffect}s over the composited frame. A
 * `Stage` owns one (lazily, via `stage.postProcess`) and, when the pipeline is
 * {@link PostProcessPipeline.active}, hands it the screen's render target
 * instead of blitting to the canvas itself. The pipeline resolves that target
 * (MSAA → a sampleable single-sample texture), runs each enabled pass as a
 * fullscreen draw ping-ponging between two pooled targets, and blits the final
 * result to the canvas.
 *
 * Fullscreen passes run with depth off and **blending disabled** — each pass
 * overwrites every pixel, so the target is neither cleared nor blended (the
 * fastest path, and the correct one for premultiplied color).
 *
 * GPU resources build lazily and rebuild after a context loss. When no enabled
 * effect is present the pipeline is inert and the `Stage` keeps its normal
 * present path.
 *
 * @category Render
 */
export class PostProcessPipeline {
  readonly #device: GfxDevice
  #effects: PostEffect[] = []

  /**
   * Shared fullscreen-triangle vertex buffer; null until first use / after
   * loss.
   */
  #vbo: VBuffer | null = null
  /** Compiled program + VAO per pass. */
  #passGpu = new Map<PostPass, PassGpu>()

  /** Reusable render targets, keyed by size + color space. */
  #pool: PooledTarget[] = []
  /** Target keys acquired during the current `run`, to prune stale sizes after. */
  #usedKeys = new Set<string>()

  /** Seconds accumulated across the pipeline's life, for animated effects. */
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

  /** The effects in run order. */
  get effects(): readonly PostEffect[] {
    return this.#effects
  }

  /** Append an effect (runs last). Returns it for convenient inline use. */
  add<T extends PostEffect>(effect: T): T {
    if (!this.#effects.includes(effect)) this.#effects.push(effect)
    return effect
  }

  /** Remove an effect and free the GPU resources of its passes. */
  remove(effect: PostEffect): void {
    const i = this.#effects.indexOf(effect)
    if (i < 0) return
    this.#effects.splice(i, 1)
    for (const pass of effect.passes) {
      const gpu = this.#passGpu.get(pass)
      if (gpu) {
        this.#device.deleteVao(gpu.vao)
        this.#device.deleteProgram(gpu.program)
        this.#passGpu.delete(pass)
      }
    }
  }

  /**
   * Run the effect chain over `source` and present to the canvas. `source` is
   * the screen's render target (may be multisampled); `canvasW`/`canvasH` are
   * the canvas drawing-buffer size. No-op when {@link active} is false.
   */
  run(
    source: RenderTarget,
    opts: { canvasW: number; canvasH: number; dt: number },
  ): void {
    if (!this.active) return
    const device = this.#device
    this.#time += opts.dt
    this.#ensureVbo()
    this.#usedKeys.clear()

    const w = source.width
    const h = source.height
    const cs = source.colorSpace

    // Resolve the (possibly MSAA) frame into a sampleable single-sample target.
    let read = this.#acquire(w, h, cs)
    device.resolveTo(source, read)

    // Fullscreen passes: no depth, no cull, no blend (each overwrites fully).
    device.setDepthTest(false)
    device.setDepthWrite(false)
    device.setCullFace('none')
    device.setBlend('none')

    const ctx: PostPassContext = {
      width: w,
      height: h,
      texelW: 1 / w,
      texelH: 1 / h,
      time: this.#time,
      dt: opts.dt,
    }

    for (const effect of this.#effects) {
      if (!effect.enabled) continue
      for (const pass of effect.passes) {
        const dst = this.#acquire(w, h, cs)
        const gpu = this.#gpuFor(pass)
        device.bindRenderTarget(dst)
        device.useProgram(gpu.program)
        device.bindVao(gpu.vao)
        // Single-sample targets carry a sampleable color texture (same cast
        // idiom as GpuGfx.colorTexture); every pooled target is single-sample.
        const tex = (read as { color?: Texture }).color
        if (tex) device.setUniformTexture(gpu.program, 'u_tex', tex, 0)
        pass.bind(device, gpu.program, ctx)
        device.drawArrays(0, 3)
        this.#release(read)
        read = dst
      }
    }

    // Present the final target. Same device-pixel size as the canvas, so a
    // nearest blit is exact and sidesteps the MSAA-linear constraint.
    device.blitToDefault(read, opts.canvasW, opts.canvasH, {
      filter: 'nearest',
    })
    this.#release(read)
    this.#pruneStale()
  }

  destroy(): void {
    this.#offRestore()
    for (const { program, vao } of this.#passGpu.values()) {
      this.#device.deleteVao(vao)
      this.#device.deleteProgram(program)
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
    this.#vbo = this.#device.createVertexBuffer(FULLSCREEN_TRI.byteLength)
    this.#device.updateBufferSubData(this.#vbo, 0, FULLSCREEN_TRI)
  }

  #gpuFor(pass: PostPass): PassGpu {
    let gpu = this.#passGpu.get(pass)
    if (!gpu) {
      const program = this.#device.createProgram({
        vertexSrc: fullscreenVertSrc,
        fragmentSrc: pass.fragmentSrc,
        attribs: { a_pos: LOC_POS },
      })
      const vao = this.#device.createVao(program, [
        {
          buffer: this.#vbo!,
          location: LOC_POS,
          size: 2,
          type: 'float',
          normalized: false,
          offset: 0,
          stride: 8,
          divisor: 0,
        },
      ])
      gpu = { program, vao }
      this.#passGpu.set(pass, gpu)
    }
    return gpu
  }

  /** Claim a free pooled target of this size/space, or allocate a new one. */
  #acquire(w: number, h: number, colorSpace: 'linear' | 'srgb'): RenderTarget {
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

  /** Drop pooled targets whose size/space wasn't used this frame (e.g. resize). */
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
    // GL handles are dead after a loss; drop references and let the next run
    // rebuild the VBO, programs, and targets lazily.
    this.#vbo = null
    this.#passGpu.clear()
    this.#pool.length = 0
  }
}
