/**
 * Renders the print picker's label previews without letting them pile up.
 *
 * Every capture shares one stage, so captures run one after another, and a
 * print queued behind a backlog of stale previews would wait for all of them.
 * The queue keeps at most one job running and one waiting. A newer request
 * replaces the waiting one, and a running job stops at its next capture once a
 * newer one exists, closing the bitmap it no longer needs.
 *
 * A job renders the variants in the order given, the selected one first, with a
 * pause between captures so the frames in between stay smooth.
 */

export interface LabelPreviewQueueOptions<Input, Variant> {
  /** Render one variant of the label for `input`. */
  render(input: Input, variant: Variant): Promise<ImageBitmap>
  /** Show a finished preview. The bitmap is the receiver's to keep or close. */
  show(variant: Variant, bitmap: ImageBitmap): void
  /** Wait between captures, such as one frame. */
  pause(): Promise<void>
  /** How long a debounced request waits for the next one. Default 150. */
  debounceMs?: number
}

export class LabelPreviewQueue<Input, Variant> {
  readonly #opts: LabelPreviewQueueOptions<Input, Variant>
  #generation = 0
  #running = false
  #waiting: {
    input: Input
    order: readonly Variant[]
    generation: number
  } | null = null
  #timer: ReturnType<typeof setTimeout> | null = null
  #disposed = false

  constructor(opts: LabelPreviewQueueOptions<Input, Variant>) {
    this.#opts = opts
  }

  /**
   * Render every variant in `order` for `input`. With `debounce`, the request
   * waits {@link LabelPreviewQueueOptions.debounceMs} for a newer one first,
   * which suits typing.
   */
  request(
    input: Input,
    order: readonly Variant[],
    { debounce = false }: { debounce?: boolean } = {},
  ): void {
    if (this.#disposed) return
    const generation = ++this.#generation
    this.#clearTimer()
    const enqueue = () => {
      this.#waiting = { input, order, generation }
      void this.#drain()
    }
    if (debounce) {
      this.#timer = setTimeout(enqueue, this.#opts.debounceMs ?? 150)
    } else {
      enqueue()
    }
  }

  /** Drop any waiting work. A running capture finishes and is closed. */
  cancel(): void {
    this.#generation++
    this.#waiting = null
    this.#clearTimer()
  }

  /** {@link cancel}, and refuse requests from now on. */
  dispose(): void {
    this.#disposed = true
    this.cancel()
  }

  #clearTimer(): void {
    if (this.#timer !== null) clearTimeout(this.#timer)
    this.#timer = null
  }

  async #drain(): Promise<void> {
    if (this.#running) return
    this.#running = true
    try {
      while (this.#waiting) {
        const job = this.#waiting
        this.#waiting = null
        await this.#run(job.input, job.order, job.generation)
      }
    } finally {
      this.#running = false
    }
  }

  async #run(
    input: Input,
    order: readonly Variant[],
    generation: number,
  ): Promise<void> {
    for (const [i, variant] of order.entries()) {
      if (generation !== this.#generation) return
      if (i > 0) await this.#opts.pause()
      if (generation !== this.#generation) return
      let bitmap: ImageBitmap
      try {
        bitmap = await this.#opts.render(input, variant)
      } catch (err) {
        console.warn('[print] label preview failed:', err)
        return
      }
      if (generation !== this.#generation) {
        bitmap.close()
        return
      }
      this.#opts.show(variant, bitmap)
    }
  }
}
