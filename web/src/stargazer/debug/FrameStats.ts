/**
 * Ring-buffer of recent frame `dt` samples with lazy percentile computation.
 *
 * Constructed and updated only while the debug HUD is active, the plan's
 * zero-overhead-when-off contract keeps this out of the hot path in
 * production.
 */
export class FrameStats {
  private readonly buf: Float32Array
  readonly capacity: number
  private cursor = 0
  private filled = 0
  private readonly sortScratch: Float32Array

  constructor(capacity = 300) {
    this.capacity = capacity
    this.buf = new Float32Array(capacity)
    this.sortScratch = new Float32Array(capacity)
  }

  push(dt: number): void {
    this.buf[this.cursor] = dt
    this.cursor = (this.cursor + 1) % this.capacity
    if (this.filled < this.capacity) this.filled++
  }

  clear(): void {
    this.cursor = 0
    this.filled = 0
  }

  get count(): number {
    return this.filled
  }

  /**
   * Copy the currently-held samples into `out` in oldest-to-newest order.
   * Returns the number of samples written (min of `out.length` and `count`).
   * Zero-alloc, the graph reuses one scratch buffer.
   */
  readOrdered(out: Float32Array): number {
    const n = Math.min(out.length, this.filled)
    if (n === 0) return 0
    const cap = this.capacity
    // If we haven't wrapped yet, samples live at [0, filled).
    // After wrapping, cursor points at the oldest slot.
    const start = this.filled < cap ? 0 : this.cursor
    for (let i = 0; i < n; i++) {
      out[i] = this.buf[(start + i) % cap]
    }
    return n
  }

  percentiles(): {
    p50: number
    p95: number
    p99: number
    max: number
    count: number
  } {
    const n = this.filled
    if (n === 0) return { p50: 0, p95: 0, p99: 0, max: 0, count: 0 }
    // Copy into a scratch typed array and sort. For n = 300 this is trivially
    // fast; we allocate no per-call arrays.
    for (let i = 0; i < n; i++) this.sortScratch[i] = this.buf[i]
    // Sort only the filled prefix.
    const slice = this.sortScratch.subarray(0, n).sort()
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
