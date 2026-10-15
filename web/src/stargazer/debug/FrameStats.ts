import { RingSeries, type SeriesSource } from './RingSeries'

/**
 * Ring-buffer of recent frame `dt` samples with lazy percentile computation.
 *
 * Constructed and updated only while the debug HUD is active, the plan's
 * zero-overhead-when-off contract keeps this out of the hot path in
 * production.
 */
export class FrameStats implements SeriesSource {
  readonly #series: RingSeries
  readonly #sortScratch: Float32Array

  constructor(capacity = 300) {
    this.#series = new RingSeries(capacity)
    this.#sortScratch = new Float32Array(capacity)
  }

  /** Samples held before the oldest is overwritten. */
  get capacity(): number {
    return this.#series.capacity
  }

  /** Record one frame delta, overwriting the oldest sample once full. */
  push(dt: number): void {
    this.#series.push(dt)
  }

  /** Drop every sample. */
  clear(): void {
    this.#series.clear()
  }

  /** Samples currently held, up to {@link FrameStats.capacity}. */
  get count(): number {
    return this.#series.count
  }

  /**
   * Copy the currently-held samples into `out` in oldest-to-newest order.
   * Returns the number of samples written (min of `out.length` and `count`).
   * Zero-alloc, the graph reuses one scratch buffer.
   */
  readOrdered(out: Float32Array): number {
    return this.#series.readOrdered(out)
  }

  percentiles(): {
    p50: number
    p95: number
    p99: number
    max: number
    count: number
  } {
    const n = this.#series.count
    if (n === 0) return { p50: 0, p95: 0, p99: 0, max: 0, count: 0 }
    // Copy into a scratch typed array and sort. For n = 300 this is trivially
    // fast, and it allocates no per-call arrays.
    this.#sortScratch.set(this.#series.unordered)
    // Sort only the filled prefix.
    const slice = this.#sortScratch.subarray(0, n).sort()
    const pick = (q: number): number =>
      slice[Math.min(n - 1, Math.floor(n * q))]
    return {
      p50: pick(0.5),
      p95: pick(0.95),
      p99: pick(0.99),
      max: slice[n - 1],
      count: n,
    }
  }
}
