import type {
  ColorFormat,
  GfxDevice,
  Readback,
  RenderTarget,
  Texture,
  UBuffer,
} from '../gfx/GfxDevice'
import {
  MAX_POST_TEXTURES,
  UNPLACED,
  isDataPass,
  type PostDataPass,
  type PostEffect,
  type PostPassContext,
  type PostPlacement,
  type PostSourceInfo,
  type PostStep,
} from './PostEffect'
import { DataTexture } from '../gfx/ShaderQuad'
import { POST_PARAMS_UBO_BINDING } from '../gfx/batchLayout'
import type { RenderTargetPool } from '../gfx/RenderTargetPool'
import {
  PASS_GPU_GRACE_FRAMES,
  POST_DATA_OUTPUT,
  POST_FIRST_EXTRA_TEX,
  POST_U_TEX,
  type PostProgramCache,
} from './PostProgramCache'

/** The texture a chain reads, with the size of the region that holds the image. */
export interface PostChainSource {
  texture: Texture
  width: number
  height: number
  /** Where the source sits. Default {@link UNPLACED}. */
  placement?: PostPlacement
}

/** The params uniform buffer one chain owns for one pass. */
interface PassParams {
  ubo: UBuffer
  staging: Float32Array
  /** Consecutive `run` calls no effect has listed this pass. */
  unseenRuns: number
}

/** What a chain keeps for one {@link PostDataPass}. */
interface DataState {
  texture: Texture
  width: number
  height: number
  /** Counts results that changed the texture, so a cached layer can see them. */
  version: number
  /** The CPU route's read of the input, until its pixels arrive. */
  pending: Readback | null
  /** The context the pending read was started under, for `cpu`. */
  pendingContext: PostPassContext | null
  /** Hash of the params the pending read was started under. */
  pendingParams: number
  /** Hash of the input and params the texture was last made from. */
  resultKey: number
  unseenRuns: number
}

/** FNV-1a over a byte range. */
function hashBytes(bytes: Uint8Array, seed = 0x811c9dc5): number {
  let hash = seed
  for (let i = 0; i < bytes.length; i++) {
    hash = Math.imul(hash ^ bytes[i], 0x01000193)
  }
  return hash >>> 0
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
  readonly #params = new Map<PostStep, PassParams>()
  readonly #data = new Map<PostDataPass, DataState>()
  readonly #warned = new Set<PostDataPass>()
  #generation: number
  #time = 0
  #dt = 0

  // Change detection (see `paramsChanged`).
  #passesSeen: PostStep[] = []
  #sigPrev = new Float32Array(0)
  #sigPrevLen = -1
  #sigCur = new Float32Array(0)
  #scratch = new Float32Array(0)

  // The plan for one run, rebuilt by `#plan` and reused between runs.
  readonly #flat: PostStep[] = []
  readonly #widths: number[] = []
  readonly #heights: number[] = []
  readonly #lastUse: number[] = []
  /** Per pass, the index of the pass it reads at `u_tex`, or -1 for the source. */
  readonly #inputs: number[] = []
  /** Per pass and extra texture slot, a pass index, -1 (source) or -2 (data). */
  readonly #extras: number[] = []
  readonly #produced = new Map<PostStep, number>()
  readonly #info: PostSourceInfo = { ...UNPLACED, width: 0, height: 0 }

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
    this.#collectReadbacks()
  }

  /**
   * Compile (or confirm) the pipelines of every enabled pass for `cs`. Returns
   * true when they are all ready. A false return means a pipeline is still
   * compiling, and the caller should use the unprocessed source for the frame.
   */
  prepare(effects: readonly PostEffect[], cs: ColorFormat): boolean {
    this.#programs.vbo()
    this.#plan(this.#sourceInfo({ width: 1, height: 1 }), effects)
    let ready = true
    for (const effect of effects) {
      if (!effect.enabled) continue
      for (const step of effect.passes) {
        if (isDataPass(step)) {
          const computes = step.compute && this.#device.supportsCompute
          if (computes && !this.#programs.computePipeline(step)) ready = false
        } else if (!this.#programs.pipeline(step, cs)) {
          ready = false
        }
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

    let any = false
    for (const effect of effects) {
      if (effect.enabled && effect.passes.length > 0) any = true
    }
    if (!any) return null

    const uvYDown = device.ndc.textureTopDown
    const vbo = this.#programs.vbo()
    const info = this.#sourceInfo(src)
    const flat = this.#plan(info, effects)
    const targets: (RenderTarget | null)[] = new Array(flat.length).fill(null)
    const dataTextures: (Texture | null)[] = new Array(flat.length).fill(null)
    let result: RenderTarget | null = null
    for (let i = 0; i < flat.length; i++) {
      const step = flat[i]
      const inputIndex = this.#inputs[i]
      const readW = inputIndex < 0 ? src.width : this.#widths[inputIndex]
      const readH = inputIndex < 0 ? src.height : this.#heights[inputIndex]
      if (isDataPass(step)) {
        const ctx = this.#context(
          this.#widths[i],
          this.#heights[i],
          readW,
          readH,
          uvYDown,
          info,
        )
        dataTextures[i] = this.#runData(
          step,
          ctx,
          this.#textureOf(inputIndex, src, targets, dataTextures),
          inputIndex >= 0 ? targets[inputIndex] : null,
        )
        continue
      }
      const pass = step
      const isLast = i === flat.length - 1
      const dstW = this.#widths[i]
      const dstH = this.#heights[i]
      const dst =
        isLast && dest ? dest : this.#pool.acquireTransient(dstW, dstH, cs)
      targets[i] = dst
      const ctx = this.#context(dstW, dstH, readW, readH, uvYDown, info)
      const params = this.#paramsFor(pass)
      if (params && pass.writeParams) {
        params.staging.fill(0)
        pass.writeParams(ctx, params.staging)
        device.updateUniformBuffer(params.ubo, params.staging)
      }
      const entries = [
        {
          binding: POST_U_TEX,
          resource: {
            texture: this.#textureOf(inputIndex, src, targets, dataTextures),
          },
        },
      ]
      const extras = pass.textures
      for (let t = 0; extras && t < extras.length; t++) {
        const extra = extras[t]
        const from = this.#extras[i * MAX_POST_TEXTURES + t]
        const texture =
          extra instanceof DataTexture
            ? this.#programs.dataTexture(extra)
            : this.#textureOf(from, src, targets, dataTextures)
        entries.push({
          binding: POST_FIRST_EXTRA_TEX + t,
          resource: { texture },
        })
      }
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
      if (isLast) {
        result = dst
        targets[i] = null
      }
      // Free what no later pass reads. The last pass's target may be the
      // canvas, which has no texture to read and is not read again.
      for (let k = 0; k <= i; k++) {
        const held = targets[k]
        if (held && this.#lastUse[k] <= i) {
          this.#pool.release(held)
          targets[k] = null
        }
      }
    }
    this.#pruneParams(effects)
    return result
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
   *
   * A data pass that runs on the CPU also counts each result that changed its
   * texture, so a cached layer draws again when one arrives.
   */
  paramsChanged(
    src: { width: number; height: number; placement?: PostPlacement },
    effects: readonly PostEffect[],
  ): boolean {
    const uvYDown = this.#device.ndc.textureTopDown
    const info = this.#sourceInfo(src)
    const flat = this.#plan(info, effects)
    const passes: PostStep[] = []
    let len = 0
    const append = (value: number): void => {
      if (this.#sigCur.length < len + 1) {
        const grown = new Float32Array(Math.max(len + 1, len * 2))
        grown.set(this.#sigCur.subarray(0, len))
        this.#sigCur = grown
      }
      this.#sigCur[len++] = value
    }
    for (let i = 0; i < flat.length; i++) {
      const step = flat[i]
      passes.push(step)
      if (step.paramsBytes > 0 && step.writeParams) {
        const n = step.paramsBytes / 4
        if (this.#scratch.length < n) this.#scratch = new Float32Array(n)
        const view = this.#scratch.subarray(0, n)
        view.fill(0)
        const from = this.#inputs[i]
        step.writeParams(
          this.#context(
            this.#widths[i],
            this.#heights[i],
            from < 0 ? src.width : this.#widths[from],
            from < 0 ? src.height : this.#heights[from],
            uvYDown,
            info,
          ),
          view,
        )
        for (let k = 0; k < n; k++) append(view[k])
      }
      if (isDataPass(step)) append(this.#data.get(step)?.version ?? 0)
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

  /** Free the params buffers and data textures of `effect`'s passes now. */
  releaseEffect(effect: PostEffect): void {
    for (const step of effect.passes) {
      const params = this.#params.get(step)
      if (params) {
        this.#device.deleteUniformBuffer(params.ubo)
        this.#params.delete(step)
      }
      if (isDataPass(step)) this.#freeData(step)
    }
  }

  /**
   * Forget every handle without freeing it, for the owner to call after a
   * context restore, when the handles are already dead.
   */
  abandon(): void {
    this.#params.clear()
    this.#data.clear()
    this.#generation = this.#programs.generation
  }

  destroy(): void {
    for (const params of this.#params.values()) {
      this.#device.deleteUniformBuffer(params.ubo)
    }
    this.#params.clear()
    for (const pass of [...this.#data.keys()]) this.#freeData(pass)
  }

  // --- internals -------------------------------------------------------------

  #context(
    width: number,
    height: number,
    inputWidth: number,
    inputHeight: number,
    uvYDown: boolean,
    source: PostSourceInfo,
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
      source,
    }
  }

  /** The source's size and placement, in the chain's reused record. */
  #sourceInfo(src: {
    width: number
    height: number
    placement?: PostPlacement
  }): PostSourceInfo {
    const info = this.#info
    const placement = src.placement ?? UNPLACED
    info.width = src.width
    info.height = src.height
    info.originX = placement.originX
    info.originY = placement.originY
    info.pxPerUnit = placement.pxPerUnit
    info.unitOriginX = placement.unitOriginX
    info.unitOriginY = placement.unitOriginY
    return info
  }

  /**
   * Flatten the enabled steps and work out, for each, its target size, what it
   * reads and when each output is last read. Throws when a step reads one that
   * does not run before it, and when the last step is a data pass, which has no
   * target to hand back.
   */
  #plan(source: PostSourceInfo, effects: readonly PostEffect[]): PostStep[] {
    const flat = this.#flat
    flat.length = 0
    for (const effect of effects) {
      if (!effect.enabled) continue
      for (const step of effect.passes) flat.push(step)
    }
    if (flat.length > 0 && isDataPass(flat[flat.length - 1])) {
      throw new Error('The last step of a post chain must be a drawing pass')
    }
    const produced = this.#produced
    produced.clear()
    this.#extras.length = flat.length * MAX_POST_TEXTURES
    for (let i = 0; i < flat.length; i++) {
      const step = flat[i]
      let width: number
      let height: number
      if (isDataPass(step) || step.size) {
        const size = step.size!(source)
        width = size.width
        height = size.height
      } else {
        const scale = step.scale ?? 1
        width = source.width * scale
        height = source.height * scale
      }
      this.#widths[i] = Math.max(1, Math.floor(width))
      this.#heights[i] = Math.max(1, Math.floor(height))
      this.#lastUse[i] = i
      const input = step.input
      const from =
        input === undefined || input === 'previous'
          ? i - 1
          : input === 'source'
            ? -1
            : this.#earlier(produced, input)
      this.#inputs[i] = from
      if (from >= 0) this.#lastUse[from] = Math.max(this.#lastUse[from], i)
      const extras = isDataPass(step) ? undefined : step.textures
      if (extras && extras.length > MAX_POST_TEXTURES) {
        throw new Error(
          `PostPass lists ${extras.length} textures, the most is ${MAX_POST_TEXTURES}`,
        )
      }
      for (let t = 0; t < MAX_POST_TEXTURES; t++) {
        const extra = extras?.[t]
        let slot = -2
        if (extra === 'source') slot = -1
        else if (extra !== undefined && !(extra instanceof DataTexture)) {
          slot = this.#earlier(produced, extra)
          this.#lastUse[slot] = Math.max(this.#lastUse[slot], i)
        }
        this.#extras[i * MAX_POST_TEXTURES + t] = slot
      }
      produced.set(step, i)
    }
    return flat
  }

  #earlier(produced: Map<PostStep, number>, step: PostStep): number {
    const index = produced.get(step)
    if (index === undefined) {
      throw new Error('A PostPass reads a pass that does not run before it')
    }
    return index
  }

  /** The texture of a step's output, or the chain's source for -1. */
  #textureOf(
    index: number,
    src: PostChainSource,
    targets: (RenderTarget | null)[],
    dataTextures: (Texture | null)[],
  ): Texture {
    if (index < 0) return src.texture
    return dataTextures[index] ?? this.#device.colorTexture(targets[index]!)
  }

  /**
   * Run one data pass: dispatch its compute shader where the device has
   * compute, otherwise keep a read of its input going for the CPU. Returns the
   * texture that holds the result.
   */
  #runData(
    pass: PostDataPass,
    ctx: PostPassContext,
    input: Texture,
    inputTarget: RenderTarget | null,
  ): Texture {
    const device = this.#device
    const computes = !!pass.compute && device.supportsCompute
    const state = this.#dataState(pass, ctx.width, ctx.height, computes)
    const params = this.#paramsFor(pass)
    if (params && pass.writeParams) {
      params.staging.fill(0)
      pass.writeParams(ctx, params.staging)
      device.updateUniformBuffer(params.ubo, params.staging)
    }
    if (computes) {
      const pipeline = this.#programs.computePipeline(pass)
      if (!pipeline) return state.texture
      const entries = [
        { binding: POST_U_TEX, resource: { texture: input } },
        { binding: POST_DATA_OUTPUT, resource: { texture: state.texture } },
      ]
      if (params) {
        entries.push({
          binding: POST_PARAMS_UBO_BINDING,
          resource: { uniformBuffer: params.ubo } as never,
        })
      }
      const [x, y, z] = pass.compute!.workgroups(ctx)
      device.beginComputePass()
      device.dispatchCompute({
        pipeline,
        bindGroups: [
          {
            group: 0,
            bindGroup: device.createBindGroup(
              this.#programs.dataLayout(pass),
              entries,
            ),
          },
        ],
        x,
        y,
        z,
      })
      device.endComputePass()
      return state.texture
    }
    if (!pass.cpu || !device.supportsReadback || !inputTarget) {
      this.#warnOnce(
        pass,
        'A data pass has no way to run here: it needs a compute shader on a device with compute, or a cpu function and a drawing pass as its input on one without',
      )
      return state.texture
    }
    if (!state.pending) {
      state.pendingParams = params
        ? hashBytes(new Uint8Array(params.staging.buffer))
        : 0
      state.pendingContext = { ...ctx }
      state.pending = device.beginReadback(inputTarget)
    }
    return state.texture
  }

  /**
   * Take the finished reads of every data pass and turn them into textures.
   * `cpu` runs only when the input pixels or the params differ from the ones
   * the texture was last made from.
   */
  #collectReadbacks(): void {
    const device = this.#device
    for (const [pass, state] of this.#data) {
      if (!state.pending) continue
      const bytes = device.pollReadback(state.pending)
      if (!bytes) continue
      state.pending = null
      const key = hashBytes(bytes, state.pendingParams ^ 0x811c9dc5)
      if (key === state.resultKey) continue
      state.resultKey = key
      const ctx = state.pendingContext!
      const output = new Uint8ClampedArray(state.width * state.height * 4)
      pass.cpu!(
        { data: bytes, width: ctx.inputWidth, height: ctx.inputHeight },
        output,
        ctx,
      )
      device.updateTexture2DData(state.texture, output)
      state.version++
    }
  }

  /** The state of `pass`, with a texture of the size asked for. */
  #dataState(
    pass: PostDataPass,
    width: number,
    height: number,
    storage: boolean,
  ): DataState {
    let state = this.#data.get(pass)
    if (state && (state.width !== width || state.height !== height)) {
      this.#freeData(pass)
      state = undefined
    }
    if (!state) {
      state = {
        texture: this.#device.createTexture2D({
          width,
          height,
          filter: 'nearest',
          wrap: 'clamp',
          storage,
        }),
        width,
        height,
        version: 0,
        pending: null,
        pendingContext: null,
        pendingParams: 0,
        resultKey: NaN,
        unseenRuns: 0,
      }
      this.#data.set(pass, state)
    }
    state.unseenRuns = 0
    return state
  }

  #freeData(pass: PostDataPass): void {
    const state = this.#data.get(pass)
    if (!state) return
    if (state.pending) this.#device.cancelReadback(state.pending)
    this.#device.deleteTexture(state.texture)
    this.#data.delete(pass)
  }

  #warnOnce(pass: PostDataPass, message: string): void {
    if (this.#warned.has(pass)) return
    this.#warned.add(pass)
    console.warn(message)
  }

  #paramsFor(pass: PostStep): PassParams | null {
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
    this.#data.clear()
    this.#generation = this.#programs.generation
  }

  /**
   * Free the params buffers and data textures of steps no listed effect has run
   * for the grace period. Called after the run's last draw, so a buffer bound
   * this frame is never freed, and with the same grace as the shaders so a
   * cycling effect gets its buffers back.
   */
  #pruneParams(effects: readonly PostEffect[]): void {
    if (this.#params.size === 0 && this.#data.size === 0) return
    const live = new Set<PostStep>()
    for (const effect of effects) {
      for (const step of effect.passes) live.add(step)
    }
    for (const [step, params] of this.#params) {
      if (live.has(step)) {
        params.unseenRuns = 0
        continue
      }
      if (++params.unseenRuns <= PASS_GPU_GRACE_FRAMES) continue
      this.#device.deleteUniformBuffer(params.ubo)
      this.#params.delete(step)
    }
    for (const [pass, state] of this.#data) {
      if (live.has(pass)) continue
      if (++state.unseenRuns > PASS_GPU_GRACE_FRAMES) this.#freeData(pass)
    }
  }
}
