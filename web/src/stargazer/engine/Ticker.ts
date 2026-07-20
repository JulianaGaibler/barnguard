/** RAF jitter allowance (ms) so a frame arriving a hair early isn't skipped. */
const CAP_TOLERANCE_MS = 1
/** EMA weight for delta smoothing: higher tracks faster, lower filters harder. */
const DELTA_SMOOTHING = 0.15
/** Relative jump beyond which delta smoothing snaps (a real hitch, not jitter). */
const DELTA_SNAP_RATIO = 0.5

/**
 * Drives the frame loop off `requestAnimationFrame`. Runs a variable-rate
 * render step and a fixed-rate step from an accumulator. Build one with
 * {@link createTicker}.
 *
 * @category Engine
 */
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
  /** Render frame-rate cap in Hz, or 0 when uncapped (runs at display rate). */
  readonly maxFps: number
  /** Whether per-frame `dt` is smoothed to filter timer-precision jitter. */
  readonly smoothTimestep: boolean

  /** Register a render-frame callback. Returns an unsubscribe function. */
  onFrame(cb: (dt: number) => void): () => void
  /** Register a fixed-step callback. Returns an unsubscribe function. */
  onFixedStep(cb: (fixedDt: number) => void): () => void

  /**
   * Enable or disable render `dt` smoothing. On (the default) it low-pass
   * filters the frame delta so coarse timer precision (notably Firefox's ~1ms
   * `performance.now()` rounding) doesn't jitter the interpolation between
   * fixed steps. It snaps immediately on a real frame-time change, so genuine
   * hitches still register.
   */
  setSmoothTimestep(enabled: boolean): void

  /**
   * Cap the render frame rate to `fps` Hz. Pass `0` (or a non-positive value)
   * to remove the cap and render at the display rate. The fixed step is
   * unaffected: physics still advances by real elapsed time, so a lower render
   * cap just means fewer interpolated frames, not slower simulation.
   */
  setMaxFps(fps: number): void

  start(): void
  stop(): void
  readonly running: boolean
}

/**
 * Construction options for {@link createTicker}.
 *
 * @category Engine
 */
export interface TickerOptions {
  /** Hz for the deterministic inner step. Default 120. */
  fixedStepHz?: number
  /** Upper bound on a render dt in seconds. Default `1/30`. */
  maxDt?: number
  /** Render frame-rate cap in Hz. Default 0 (uncapped, runs at display rate). */
  maxFps?: number
  /** Smooth render `dt` to filter timer-precision jitter. Default true. */
  smoothTimestep?: boolean
}

class TickerImpl implements Ticker {
  time = 0
  dt = 0
  frameNum = 0
  fixedAlpha = 0
  readonly fixedDt: number
  running = false

  readonly #maxDt: number
  #accumulator = 0
  #lastMs = 0
  #rafId = 0
  /** Requested render cap in Hz; 0 = uncapped. Stored exactly for readback. */
  #_maxFps = 0
  /** Minimum ms between processed frames; 0 = uncapped. */
  #minFrameMs = 0
  /** Earliest timestamp the next frame may be processed (cap scheduling). */
  #nextFrameMs = 0
  /** Whether to low-pass filter the frame delta. */
  #_smoothTimestep: boolean
  /** Filtered frame delta in seconds; 0 = not yet seeded. */
  #smoothedDt = 0
  readonly #frameCallbacks = new Set<(dt: number) => void>()
  readonly #fixedCallbacks = new Set<(fixedDt: number) => void>()

  constructor(opts: TickerOptions = {}) {
    this.#maxDt = opts.maxDt ?? 1 / 30
    this.fixedDt = 1 / (opts.fixedStepHz ?? 120)
    this.#_smoothTimestep = opts.smoothTimestep ?? true
    this.setMaxFps(opts.maxFps ?? 0)
  }

  get smoothTimestep(): boolean {
    return this.#_smoothTimestep
  }

  setSmoothTimestep(enabled: boolean): void {
    this.#_smoothTimestep = enabled
    this.#smoothedDt = 0 // re-seed on next frame
  }

  get maxFps(): number {
    return this.#_maxFps
  }

  setMaxFps(fps: number): void {
    this.#_maxFps = fps > 0 ? fps : 0
    this.#minFrameMs = this.#_maxFps > 0 ? 1000 / this.#_maxFps : 0
    // Reset scheduling so the new cap takes effect from the next frame.
    this.#nextFrameMs = 0
  }

  onFrame(cb: (dt: number) => void): () => void {
    this.#frameCallbacks.add(cb)
    return () => {
      this.#frameCallbacks.delete(cb)
    }
  }

  onFixedStep(cb: (fixedDt: number) => void): () => void {
    this.#fixedCallbacks.add(cb)
    return () => {
      this.#fixedCallbacks.delete(cb)
    }
  }

  start(): void {
    if (this.running) return
    this.running = true
    this.#lastMs = performance.now()
    this.#accumulator = 0
    this.#nextFrameMs = 0
    this.#smoothedDt = 0
    this.#rafId = requestAnimationFrame(this.#loop)
  }

  stop(): void {
    if (!this.running) return
    this.running = false
    cancelAnimationFrame(this.#rafId)
  }

  #loop = (nowMs: number): void => {
    if (!this.running) return
    // Always poll at the display rate so the cap can land on the nearest rAF.
    this.#rafId = requestAnimationFrame(this.#loop)

    // Frame-rate cap: skip processing rAFs that arrive before the next
    // scheduled frame. Scheduling by target time (rather than "time since last
    // frame") keeps the average rate accurate on high-refresh displays; the
    // `Math.max` clamp stops it from bursting catch-up frames after a stall.
    if (this.#minFrameMs > 0) {
      if (this.#nextFrameMs === 0) this.#nextFrameMs = nowMs
      else if (nowMs < this.#nextFrameMs - CAP_TOLERANCE_MS) return
      this.#nextFrameMs = Math.max(nowMs, this.#nextFrameMs + this.#minFrameMs)
    }

    const rawDt = (nowMs - this.#lastMs) / 1000
    this.#lastMs = nowMs
    let dt = Math.max(0, Math.min(rawDt, this.#maxDt))
    // Delta smoothing: EMA-filter the frame time so coarse timer precision
    // (Firefox rounds performance.now() to ~1ms) doesn't jitter interpolation.
    // Snap on a large jump so real hitches / rate changes register immediately.
    if (this.#_smoothTimestep) {
      if (this.#smoothedDt <= 0) {
        this.#smoothedDt = dt
      } else if (
        Math.abs(dt - this.#smoothedDt) >
        this.#smoothedDt * DELTA_SNAP_RATIO
      ) {
        this.#smoothedDt = dt
      } else {
        this.#smoothedDt += (dt - this.#smoothedDt) * DELTA_SMOOTHING
      }
      dt = this.#smoothedDt
    }
    this.dt = dt
    this.time += this.dt
    this.frameNum++

    this.#accumulator += this.dt
    const fixedDt = this.fixedDt
    // Cap fixed-step iterations per frame so a huge dt after a stall doesn't spiral.
    let steps = 0
    while (this.#accumulator >= fixedDt && steps < 8) {
      for (const cb of this.#fixedCallbacks) cb(fixedDt)
      this.#accumulator -= fixedDt
      steps++
    }
    // If we hit the cap, drop the remainder, better a small time skip than a spiral.
    if (steps === 8 && this.#accumulator >= fixedDt) this.#accumulator = 0
    this.fixedAlpha = this.#accumulator / fixedDt

    for (const cb of this.#frameCallbacks) cb(this.dt)
  }
}

/**
 * Create a {@link Ticker}. It stays stopped until you call `start()`.
 *
 * @category Engine
 */
export function createTicker(opts?: TickerOptions): Ticker {
  return new TickerImpl(opts)
}
