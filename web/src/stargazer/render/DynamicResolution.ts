/**
 * Dynamic-resolution policy for a {@link Stage}. Decides, once per frame, the
 * render-scale the backing store should use so pixel-bound cost (clear, blit,
 * fresh vector re-raster, composite) can be traded off against sharpness.
 *
 * Two policies share one state machine:
 *
 * - **Transition (b)**, while the camera animates, drop to `motionScale`; motion
 *   masks the softness. On settle, hold the low scale for a short
 *   `settleDwellMs` (so tap-spamming a zoom target doesn't thrash the
 *   backing-store resize), then ramp back up over `settleStepFrames` frames (a
 *   staggered step-up hides the sharpness "pop" without a dual-bake).
 * - **Adaptive governor (a)**, a steady-state safety net for overload that isn't
 *   a camera move (busy packet field, full grid pulse). An EMA of the RAW frame
 *   time nudges a baseline scale down/up with a hysteresis deadband, evaluated
 *   every `evalIntervalFrames`. Gated OFF during any motion transition, zoom
 *   frames are expected-expensive and self-limiting, so they must not drive the
 *   steady baseline down.
 *
 * The class is PURE: `update(nowMs, camMoving)` is deterministic given its
 * inputs, so it unit-tests without a real clock or canvas. `nowMs` must be a
 * RAW wall-clock timestamp (`performance.now()`), NOT the engine's `dt`, which
 * is clamped to 1/30 s and would hide any miss above the clamp.
 */
export interface DynamicResolutionOptions {
  /** Master switch, when false, `update` always returns 1. */
  enabled: boolean
  /** Render scale applied while the camera is animating. */
  motionScale: number
  /** Hard floor the adaptive governor won't step below. */
  minScale: number
  /**
   * Governor steps the baseline DOWN when smoothed frame time exceeds this
   * (ms).
   */
  highWatermarkMs: number
  /** Governor steps the baseline UP when smoothed frame time is under this (ms). */
  lowWatermarkMs: number
  /** Steady frames between governor evaluations. */
  evalIntervalFrames: number
  /** Hold the low scale this long (ms) after motion stops before ramping up. */
  settleDwellMs: number
  /** Frames over which to ramp the scale back up to the baseline on settle. */
  settleStepFrames: number
}

export const DEFAULT_DYNAMIC_RESOLUTION: DynamicResolutionOptions = {
  enabled: false,
  motionScale: 0.55,
  minScale: 0.5,
  highWatermarkMs: 18,
  lowWatermarkMs: 13,
  evalIntervalFrames: 30,
  settleDwellMs: 200,
  settleStepFrames: 3,
}

/** EMA smoothing factor for the raw frame-time signal (~10-frame constant). */
const EMA_ALPHA = 0.1
/** Governor multiplies the baseline by this to step DOWN (react fast to jank). */
const GOVERNOR_STEP_DOWN = 0.8
/** …and by this to step UP (recover slowly to avoid oscillation). */
const GOVERNOR_STEP_UP = 1.05
/** Ignore frame gaps larger than this (ms), tab wake / first frame. */
const MAX_PLAUSIBLE_FRAME_MS = 1000

type Phase = 'steady' | 'motion' | 'dwell' | 'settle'

export class DynamicResolution {
  private readonly opts: DynamicResolutionOptions
  private lastNowMs: number | null = null
  private emaMs = 0
  private phase: Phase = 'steady'
  private movingPrev = false
  private dwellUntilMs = 0
  private settleFramesLeft = 0
  private settleFromScale = 1
  private adaptiveBaseline = 1
  private framesSinceEval = 0
  private target = 1

  constructor(opts: DynamicResolutionOptions) {
    this.opts = opts
  }

  /** The scale returned by the last `update` (what the stage should apply). */
  get currentTarget(): number {
    return this.target
  }

  /** The governor's steady-state baseline, exposed for debugging/tests. */
  get baseline(): number {
    return this.adaptiveBaseline
  }

  /** Smoothed raw frame time (ms) driving the governor, for the HUD/tests. */
  get smoothedFrameMs(): number {
    return this.emaMs
  }

  /**
   * Advance the policy one frame and return the desired render scale in `(0,
   * 1]`. See the class doc for the meaning of `nowMs`.
   */
  update(nowMs: number, camMoving: boolean): number {
    if (!this.opts.enabled) return 1

    // Raw frame-time EMA (governor input). Skip implausible gaps so one stall
    // (tab wake, first frame) doesn't skew the signal.
    if (this.lastNowMs !== null) {
      const dt = nowMs - this.lastNowMs
      if (dt > 0 && dt < MAX_PLAUSIBLE_FRAME_MS) {
        this.emaMs =
          this.emaMs === 0 ? dt : this.emaMs + (dt - this.emaMs) * EMA_ALPHA
      }
    }
    this.lastNowMs = nowMs

    // Phase transitions driven by camera motion.
    if (camMoving) {
      this.phase = 'motion'
    } else if (this.movingPrev) {
      // Motion just stopped, hold the low scale through the dwell window.
      this.phase = 'dwell'
      this.dwellUntilMs = nowMs + this.opts.settleDwellMs
    }

    switch (this.phase) {
      case 'motion':
        this.target = this.motionTarget()
        break
      case 'dwell':
        if (nowMs >= this.dwellUntilMs) {
          this.phase = 'settle'
          this.settleFramesLeft = Math.max(1, this.opts.settleStepFrames)
          this.settleFromScale = this.target
          this.target = this.stepSettle()
        } else {
          this.target = this.motionTarget()
        }
        break
      case 'settle':
        this.target = this.stepSettle()
        break
      case 'steady':
        this.runGovernor()
        this.target = this.adaptiveBaseline
        break
    }

    this.movingPrev = camMoving
    return this.target
  }

  /**
   * Never softer than the governor already wants, never harder than
   * motionScale.
   */
  private motionTarget(): number {
    return Math.min(this.opts.motionScale, this.adaptiveBaseline)
  }

  /** Linear ramp from the held low scale up to the baseline over N frames. */
  private stepSettle(): number {
    const total = Math.max(1, this.opts.settleStepFrames)
    const done = total - this.settleFramesLeft + 1
    const t = Math.min(1, done / total)
    const value =
      this.settleFromScale + (this.adaptiveBaseline - this.settleFromScale) * t
    this.settleFramesLeft--
    if (this.settleFramesLeft <= 0) this.phase = 'steady'
    return value
  }

  /** Steady-state governor, only ever called from the `'steady'` phase. */
  private runGovernor(): void {
    this.framesSinceEval++
    if (this.framesSinceEval < this.opts.evalIntervalFrames) return
    this.framesSinceEval = 0
    if (this.emaMs === 0) return
    if (
      this.emaMs > this.opts.highWatermarkMs &&
      this.adaptiveBaseline > this.opts.minScale
    ) {
      this.adaptiveBaseline = Math.max(
        this.opts.minScale,
        this.adaptiveBaseline * GOVERNOR_STEP_DOWN,
      )
    } else if (
      this.emaMs < this.opts.lowWatermarkMs &&
      this.adaptiveBaseline < 1
    ) {
      this.adaptiveBaseline = Math.min(
        1,
        this.adaptiveBaseline * GOVERNOR_STEP_UP,
      )
    }
    // Between the watermarks: deadband, hold, so the governor doesn't hunt.
  }
}
