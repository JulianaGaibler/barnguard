export interface Ticker {
  /** Total seconds since `start()`. Excludes time while stopped. */
  readonly time: number
  /** Seconds elapsed in the last render frame, clamped to `maxDt`. */
  readonly dt: number
  /** Monotonic render-frame counter. Increments before frame callbacks fire. */
  readonly frameNum: number
  /** Remaining fraction of an unconsumed fixed step: `accumulator / fixedDt`. */
  readonly fixedAlpha: number
  /** Nominal fixed-step duration in seconds. */
  readonly fixedDt: number

  onFrame(cb: (dt: number) => void): () => void
  onFixedStep(cb: (fixedDt: number) => void): () => void

  start(): void
  stop(): void
  readonly running: boolean
}

export interface TickerOptions {
  /** Hz for the deterministic inner step. Default 120. */
  fixedStepHz?: number
  /** Upper bound on a render dt in seconds. Default `1/30`. */
  maxDt?: number
}

class TickerImpl implements Ticker {
  time = 0
  dt = 0
  frameNum = 0
  fixedAlpha = 0
  readonly fixedDt: number
  running = false

  private readonly maxDt: number
  private accumulator = 0
  private lastMs = 0
  private rafId = 0
  private readonly frameCallbacks = new Set<(dt: number) => void>()
  private readonly fixedCallbacks = new Set<(fixedDt: number) => void>()

  constructor(opts: TickerOptions = {}) {
    this.maxDt = opts.maxDt ?? 1 / 30
    this.fixedDt = 1 / (opts.fixedStepHz ?? 120)
  }

  onFrame(cb: (dt: number) => void): () => void {
    this.frameCallbacks.add(cb)
    return () => {
      this.frameCallbacks.delete(cb)
    }
  }

  onFixedStep(cb: (fixedDt: number) => void): () => void {
    this.fixedCallbacks.add(cb)
    return () => {
      this.fixedCallbacks.delete(cb)
    }
  }

  start(): void {
    if (this.running) return
    this.running = true
    this.lastMs = performance.now()
    this.accumulator = 0
    this.rafId = requestAnimationFrame(this.loop)
  }

  stop(): void {
    if (!this.running) return
    this.running = false
    cancelAnimationFrame(this.rafId)
  }

  private loop = (nowMs: number): void => {
    if (!this.running) return
    const rawDt = (nowMs - this.lastMs) / 1000
    this.lastMs = nowMs
    this.dt = Math.max(0, Math.min(rawDt, this.maxDt))
    this.time += this.dt
    this.frameNum++

    this.accumulator += this.dt
    const fixedDt = this.fixedDt
    // Cap fixed-step iterations per frame so a huge dt after a stall doesn't spiral.
    let steps = 0
    while (this.accumulator >= fixedDt && steps < 8) {
      for (const cb of this.fixedCallbacks) cb(fixedDt)
      this.accumulator -= fixedDt
      steps++
    }
    // If we hit the cap, drop the remainder, better a small time skip than a spiral.
    if (steps === 8 && this.accumulator >= fixedDt) this.accumulator = 0
    this.fixedAlpha = this.accumulator / fixedDt

    for (const cb of this.frameCallbacks) cb(this.dt)

    this.rafId = requestAnimationFrame(this.loop)
  }
}

export function createTicker(opts?: TickerOptions): Ticker {
  return new TickerImpl(opts)
}
