import type {
  ColorFormat,
  GfxDevice,
  RenderTarget,
  Texture,
  UBuffer,
} from '../gfx/GfxDevice'
import type { PostEffect, PostPass, PostPassContext } from './PostEffect'
import { POST_PARAMS_UBO_BINDING } from '../gfx/batchLayout'
import type { RenderTargetPool } from '../gfx/RenderTargetPool'
import {
  PASS_GPU_GRACE_FRAMES,
  POST_U_TEX,
  type PostProgramCache,
} from './PostProgramCache'

/** The texture a chain reads, with the size of the region that holds the image. */
export interface PostChainSource {
  texture: Texture
  width: number
  height: number
}

/** The params uniform buffer one chain owns for one pass. */
interface PassParams {
  ubo: UBuffer
  staging: Float32Array
  /** Consecutive `run` calls no effect has listed this pass. */
  unseenRuns: number
}

/**
 * Runs an ordered list of {@link PostEffect}s over a source texture, one
 * fullscreen render pass per enabled {@link PostPass}, ping-ponging between
 * pooled single-sample targets. It does not present. The caller decides where
 * the result goes.
 *
 * @remarks
 *   Engine developers: a chain is the per-owner half of post-processing. The
 *   stage's pipeline owns one and every layer with effects owns one. The
 *   shaders and pipelines come from the shared {@link PostProgramCache}. The
 *   chain keeps what must not be shared: the params uniform buffers (one per
 *   pass, so the same effect instance running in two chains in one frame writes
 *   two buffers), the accumulated `time`, and the change detection state.
 *
 *   `ctx.width` and `ctx.height`, and each pass's `scale`, derive from the source
 *   size given to `run`, so the same effect sizes itself to whatever it runs
 *   over.
 *
 *   The pool is the owner's. The chain acquires transient targets from it and
 *   releases them as the passes finish, and the owner calls the pool's
 *   `endFrame`.
 */
export class PostChain {
  readonly #device: GfxDevice
  readonly #programs: PostProgramCache
  readonly #pool: RenderTargetPool
  readonly #params = new Map<PostPass, PassParams>()
  #generation: number
  #time = 0
  #dt = 0

  // Change detection (see `paramsChanged`).
  #passesSeen: PostPass[] = []
  #sigPrev = new Float32Array(0)
  #sigPrevLen = -1
  #sigCur = new Float32Array(0)
  #scratch = new Float32Array(0)

  constructor(
    device: GfxDevice,
    programs: PostProgramCache,
    pool: RenderTargetPool,
  ) {
    this.#device = device
    this.#programs = programs
    this.#pool = pool
    this.#generation = programs.generation
  }

  /** Seconds accumulated through `advance`, handed to passes as `ctx.time`. */
  get time(): number {
    return this.#time
  }

  /** Whether any enabled effect in `effects` has a pass to run. */
  static hasWork(effects: readonly PostEffect[]): boolean {
    for (const e of effects) {
      if (e.enabled && e.passes.length > 0) return true
    }
    return false
  }

  /** How many passes `run` would draw for `effects`. */
  static passCount(effects: readonly PostEffect[]): number {
    let n = 0
    for (const e of effects) {
      if (e.enabled) n += e.passes.length
    }
    return n
  }

  /** Add one frame's delta to `time`. Call once per frame before `run`. */
  advance(dt: number): void {
    this.#time += dt
    this.#dt = dt
  }

  /**
   * Compile (or confirm) the pipelines of every enabled pass for `cs`. Returns
   * true when they are all ready. A false return means a pipeline is still
   * compiling, and the caller should use the unprocessed source for the frame.
   */
  prepare(effects: readonly PostEffect[], cs: ColorFormat): boolean {
    this.#programs.vbo()
    let ready = true
    for (const effect of effects) {
      if (!effect.enabled) continue
      for (const pass of effect.passes) {
        if (!this.#programs.pipeline(pass, cs)) ready = false
      }
    }
    return ready
  }

  /**
   * Run every enabled pass over `src` and return the target that holds the
   * result, or `null` when nothing is enabled. Call `prepare` first and only
   * run when it returned true.
   *
   * With `dest`, the last pass draws straight into it, which saves a copy. It
   * must be sized for the last pass (the source size at scale 1) and in the
   * color space `cs`. Without it the result lands in a pooled target that the
   * caller returns with `release`.
   */
  run(
    src: PostChainSource,
    effects: readonly PostEffect[],
    cs: ColorFormat,
    dest: RenderTarget | null,
  ): RenderTarget | null {
    const device = this.#device
    if (this.#programs.generation !== this.#generation) this.#dropParams()

    let last: PostPass | null = null
    for (const effect of effects) {
      if (!effect.enabled) continue
      for (const pass of effect.passes) last = pass
    }
    if (!last) return null

    const uvYDown = device.ndc.textureTopDown
    const vbo = this.#programs.vbo()
    let readTexture = src.texture
    let readW = src.width
    let readH = src.height
    let read: RenderTarget | null = null
    for (const effect of effects) {
      if (!effect.enabled) continue
      for (const pass of effect.passes) {
        const scale = pass.scale ?? 1
        const dstW = Math.max(1, Math.floor(src.width * scale))
        const dstH = Math.max(1, Math.floor(src.height * scale))
        const isLast = pass === last
        const dst =
          isLast && dest ? dest : this.#pool.acquireTransient(dstW, dstH, cs)
        const ctx = this.#context(dstW, dstH, readW, readH, uvYDown)
        const params = this.#paramsFor(pass)
        if (params && pass.writeParams) {
          params.staging.fill(0)
          pass.writeParams(ctx, params.staging)
          device.updateUniformBuffer(params.ubo, params.staging)
        }
        const entries = [
          { binding: POST_U_TEX, resource: { texture: readTexture } },
        ]
        if (params) {
          entries.push({
            binding: POST_PARAMS_UBO_BINDING,
            resource: { uniformBuffer: params.ubo } as never,
          })
        }
        const bindGroup = device.createBindGroup(
          this.#programs.layout(pass),
          entries,
        )
        device.beginRenderPass({
          color: { target: dst, loadOp: 'clear', clearColor: [0, 0, 0, 0] },
        })
        device.draw({
          pipeline: this.#programs.pipeline(pass, cs)!,
          vertexBuffers: [{ buffer: vbo, offset: 0 }],
          bindGroups: [{ group: 0, bindGroup }],
          vertexCount: 3,
        })
        device.endRenderPass()
        if (read) this.#pool.release(read)
        read = dst
        // The last pass's target may be the canvas, which has no texture to
        // read and is not read again.
        if (!isLast) readTexture = device.colorTexture(dst)
        readW = dstW
        readH = dstH
      }
    }
    this.#pruneParams(effects)
    return read
  }

  /**
   * Return a pooled target `run` handed back. A `dest` the caller owns is not
   * one.
   */
  release(target: RenderTarget): void {
    this.#pool.release(target)
  }

  /**
   * Whether running `effects` over a source of this size would write different
   * parameters, or run different passes, than the last call saw. The first call
   * reports true. A layer uses it to know when a cached result is stale.
   *
   * It runs each pass's `writeParams` into scratch space with the context `run`
   * would build, so it sees exactly what the GPU would. An effect that animates
   * with `ctx.time` (grain at a frame rate) reports a change only when its
   * written value does. A `hz` of 0 writes a constant and never does.
   */
  paramsChanged(
    src: { width: number; height: number },
    effects: readonly PostEffect[],
  ): boolean {
    const uvYDown = this.#device.ndc.textureTopDown
    const passes: PostPass[] = []
    let len = 0
    let readW = src.width
    let readH = src.height
    for (const effect of effects) {
      if (!effect.enabled) continue
      for (const pass of effect.passes) {
        passes.push(pass)
        const scale = pass.scale ?? 1
        const dstW = Math.max(1, Math.floor(src.width * scale))
        const dstH = Math.max(1, Math.floor(src.height * scale))
        if (pass.paramsBytes > 0 && pass.writeParams) {
          const n = pass.paramsBytes / 4
          if (this.#scratch.length < n) this.#scratch = new Float32Array(n)
          const view = this.#scratch.subarray(0, n)
          view.fill(0)
          pass.writeParams(
            this.#context(dstW, dstH, readW, readH, uvYDown),
            view,
          )
          if (this.#sigCur.length < len + n) {
            const grown = new Float32Array(Math.max(len + n, len * 2))
            grown.set(this.#sigCur.subarray(0, len))
            this.#sigCur = grown
          }
          this.#sigCur.set(view, len)
          len += n
        }
        readW = dstW
        readH = dstH
      }
    }
    let changed =
      len !== this.#sigPrevLen || passes.length !== this.#passesSeen.length
    for (let i = 0; !changed && i < passes.length; i++) {
      if (passes[i] !== this.#passesSeen[i]) changed = true
    }
    for (let i = 0; !changed && i < len; i++) {
      if (this.#sigCur[i] !== this.#sigPrev[i]) changed = true
    }
    const prev = this.#sigPrev
    this.#sigPrev = this.#sigCur
    this.#sigPrevLen = len
    this.#sigCur = prev
    this.#passesSeen = passes
    return changed
  }

  /** Free the params buffers of `effect`'s passes now. */
  releaseEffect(effect: PostEffect): void {
    for (const pass of effect.passes) {
      const params = this.#params.get(pass)
      if (!params) continue
      this.#device.deleteUniformBuffer(params.ubo)
      this.#params.delete(pass)
    }
  }

  /**
   * Forget every handle without freeing it, for the owner to call after a
   * context restore, when the handles are already dead.
   */
  abandon(): void {
    this.#params.clear()
    this.#generation = this.#programs.generation
  }

  destroy(): void {
    for (const params of this.#params.values()) {
      this.#device.deleteUniformBuffer(params.ubo)
    }
    this.#params.clear()
  }

  // --- internals -------------------------------------------------------------

  #context(
    width: number,
    height: number,
    inputWidth: number,
    inputHeight: number,
    uvYDown: boolean,
  ): PostPassContext {
    return {
      width,
      height,
      texelW: 1 / width,
      texelH: 1 / height,
      inputWidth,
      inputHeight,
      inputTexelW: 1 / inputWidth,
      inputTexelH: 1 / inputHeight,
      uvYDown,
      time: this.#time,
      dt: this.#dt,
    }
  }

  #paramsFor(pass: PostPass): PassParams | null {
    if (pass.paramsBytes <= 0) return null
    let params = this.#params.get(pass)
    if (!params) {
      params = {
        ubo: this.#device.createUniformBuffer(pass.paramsBytes),
        staging: new Float32Array(pass.paramsBytes / 4),
        unseenRuns: 0,
      }
      this.#params.set(pass, params)
    }
    return params
  }

  #dropParams(): void {
    this.#params.clear()
    this.#generation = this.#programs.generation
  }

  /**
   * Free the params buffers of passes no listed effect has run for the grace
   * period. Called after the run's last draw, so a buffer bound this frame is
   * never freed, and with the same grace as the shaders so a cycling effect
   * gets its buffers back.
   */
  #pruneParams(effects: readonly PostEffect[]): void {
    if (this.#params.size === 0) return
    const live = new Set<PostPass>()
    for (const effect of effects) {
      for (const pass of effect.passes) live.add(pass)
    }
    for (const [pass, params] of this.#params) {
      if (live.has(pass)) {
        params.unseenRuns = 0
        continue
      }
      if (++params.unseenRuns <= PASS_GPU_GRACE_FRAMES) continue
      this.#device.deleteUniformBuffer(params.ubo)
      this.#params.delete(pass)
    }
  }
}
