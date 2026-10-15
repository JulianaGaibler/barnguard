/**
 * Fixed-capacity ring of recent samples. Every debug graph reads one: the frame
 * graph, and the sparklines on the stat cards.
 *
 * Constructed and updated only while the debug HUD is active, so it stays out
 * of the hot path in production.
 */
export class RingSeries {
  readonly #buf: Float32Array
  /** Samples held before the oldest is overwritten. */
  readonly capacity: number
  #cursor = 0
  #filled = 0

  constructor(capacity = 300) {
    this.capacity = capacity
    this.#buf = new Float32Array(capacity)
  }

  /** Record one sample, overwriting the oldest once full. */
  push(value: number): void {
    this.#buf[this.#cursor] = value
    this.#cursor = (this.#cursor + 1) % this.capacity
    if (this.#filled < this.capacity) this.#filled++
  }

  /** Drop every sample. */
  clear(): void {
    this.#cursor = 0
    this.#filled = 0
  }

  /** Samples currently held, up to {@link RingSeries.capacity}. */
  get count(): number {
    return this.#filled
  }

  /** The newest sample, or 0 when empty. */
  get last(): number {
    if (this.#filled === 0) return 0
    return this.#buf[(this.#cursor - 1 + this.capacity) % this.capacity]
  }

  /** The largest sample held, or 0 when empty. */
  get peak(): number {
    let peak = 0
    for (let i = 0; i < this.#filled; i++) {
      if (this.#buf[i] > peak) peak = this.#buf[i]
    }
    return peak
  }

  /**
   * The held samples in storage order, which is not time order once the ring
   * has wrapped. For order-free statistics such as percentiles. A view, not a
   * copy.
   */
  get unordered(): Float32Array {
    return this.#buf.subarray(0, this.#filled)
  }

  /**
   * Copy the held samples into `out` oldest to newest. Returns the number
   * written, the smaller of `out.length` and {@link RingSeries.count}. Allocates
   * nothing.
   */
  readOrdered(out: Float32Array): number {
    const n = Math.min(out.length, this.#filled)
    if (n === 0) return 0
    const cap = this.capacity
    const start = this.#filled < cap ? 0 : this.#cursor
    for (let i = 0; i < n; i++) out[i] = this.#buf[(start + i) % cap]
    return n
  }
}

/** Anything a graph can draw: a {@link RingSeries} or a {@link FrameStats}. */
export interface SeriesSource {
  readonly capacity: number
  readonly count: number
  readOrdered(out: Float32Array): number
}

/**
 * Fold `n` ordered samples into `cols` columns, keeping the largest sample of
 * each column's slice so a spike survives the fold. With fewer samples than
 * columns each column holds one sample and the result is right-aligned by the
 * caller. Returns the number of columns written.
 */
export function foldWorst(
  src: Float32Array,
  n: number,
  cols: number,
  out: Float32Array,
): number {
  const drawCount = Math.min(cols, n)
  for (let c = 0; c < drawCount; c++) {
    const startIdx = Math.floor((c * n) / drawCount)
    const endIdx = Math.min(
      n,
      Math.max(startIdx + 1, Math.floor(((c + 1) * n) / drawCount)),
    )
    let worst = 0
    for (let i = startIdx; i < endIdx; i++) {
      if (src[i] > worst) worst = src[i]
    }
    out[c] = worst
  }
  return drawCount
}
