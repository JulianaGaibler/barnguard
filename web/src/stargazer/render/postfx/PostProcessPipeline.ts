import type { ColorFormat, GfxDevice, RenderTarget } from '../gfx/GfxDevice'
import type { PostEffect, PostPass } from './PostEffect'
import { RenderTargetPool } from '../gfx/RenderTargetPool'
import { PostChain } from './PostChain'
import { PostProgramCache } from './PostProgramCache'

export { fullscreenTri } from './PostProgramCache'

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
 * @remarks
 *   Engine developers: the pipeline holds the stage-level concerns, which are the
 *   list of effects, the choice between presenting a result and drawing the
 *   last pass into the canvas, and the readiness fallback. The passes
 *   themselves run in a `PostChain`, and the compiled shaders live in a
 *   `PostProgramCache`, which can be shared with other chains on the same
 *   device.
 * @example
 *   stage.postProcess.add(new Vignette({ intensity: 0.6 }))
 *   stage.postProcess.add(new ChromaticAberration({ amount: 0.01 }))
 */
export class PostProcessPipeline {
  readonly #device: GfxDevice
  readonly #programs: PostProgramCache
  #effects: PostEffect[] = []
  #rtPool: RenderTargetPool
  #chain: PostChain
  readonly #offRestore: () => void

  constructor(device: GfxDevice) {
    this.#device = device
    this.#programs = new PostProgramCache(device)
    this.#rtPool = new RenderTargetPool(device)
    this.#chain = new PostChain(device, this.#programs, this.#rtPool)
    this.#offRestore = device.onContextRestored(() => this.#onContextRestored())
  }

  #processedLastRun = false

  /**
   * Whether the last {@link run} applied the effects. False while a pass
   * pipeline is still compiling, when the frame is presented unmodified. A
   * stage that renders once and parks waits for this before it parks.
   */
  get processedLastRun(): boolean {
    return this.#processedLastRun
  }

  /** True when at least one enabled effect has passes to run. */
  get active(): boolean {
    return PostChain.hasWork(this.#effects)
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
  warm(
    colorSpaces: readonly ColorFormat[] = ['linear', 'srgb', 'canvas'],
  ): void {
    const passes: PostPass[] = []
    for (const effect of this.#effects) passes.push(...effect.passes)
    this.#programs.warm(passes, colorSpaces)
  }

  remove(effect: PostEffect): void {
    const i = this.#effects.indexOf(effect)
    if (i < 0) return
    this.#effects.splice(i, 1)
    this.#chain.releaseEffect(effect)
    for (const pass of effect.passes) this.#programs.release(pass)
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
    const chain = this.#chain
    chain.advance(opts.dt)

    const cs = source.colorSpace
    const ready = chain.prepare(this.#effects, cs)
    this.#processedLastRun = ready
    if (!ready) {
      device.present(source, opts.canvasW, opts.canvasH, { filter: 'nearest' })
      return
    }

    // The last pass writes the canvas when it can, which saves copying its
    // result there. That needs a source drawn in the canvas format, and a last
    // pass at the source's size.
    let last: PostPass | null = null
    for (const effect of this.#effects) {
      if (!effect.enabled) continue
      for (const pass of effect.passes) last = pass
    }
    const toCanvas = cs === 'canvas' && last !== null && (last.scale ?? 1) === 1
    const dest = toCanvas ? device.canvasTarget() : null

    const result = chain.run(
      {
        texture: device.colorTexture(source),
        width: source.width,
        height: source.height,
      },
      this.#effects,
      cs,
      dest,
    )
    if (result && result !== dest) {
      device.present(result, opts.canvasW, opts.canvasH, { filter: 'nearest' })
      chain.release(result)
    }
    for (const effect of this.#effects) {
      for (const pass of effect.passes) this.#programs.noteLive(pass)
    }
    this.#programs.endFrame()
    this.#rtPool.endFrame()
  }

  destroy(): void {
    this.#offRestore()
    this.#chain.destroy()
    this.#programs.destroy()
    this.#rtPool.destroy()
  }

  // --- internals -------------------------------------------------------------

  #onContextRestored(): void {
    // GPU handles are dead after a loss. Drop references and let the next run
    // rebuild the shaders, pipelines and targets lazily.
    this.#chain.abandon()
    this.#rtPool = new RenderTargetPool(this.#device)
    this.#chain = new PostChain(this.#device, this.#programs, this.#rtPool)
  }
}
