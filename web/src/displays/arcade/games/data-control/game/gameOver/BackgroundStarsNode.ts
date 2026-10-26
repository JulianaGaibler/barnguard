import { Node2D, type Canvas } from 'stargazer'

export interface BackgroundStarsOptions {
  /** Star count. ~500 is a comfortable ceiling for a 4K kiosk canvas. */
  count: number
  /**
   * Stars are pre-scattered uniformly inside `[-halfExtent, halfExtent]²` in
   * world coords. As the camera pans over this rect the stars pass behind the
   * packet, that motion is what sells "the camera is travelling" to the
   * player.
   */
  halfExtent: number
  /** Random per-star radius range (world units). */
  sizeWorld: readonly [number, number]
  /** Random per-star fill alpha range. */
  alphaRange: readonly [number, number]
  /** Fill color. */
  color: string
}

/**
 * A one-shot, allocation-free starfield. Populates a `Float32Array` of `(x, y,
 * size, alpha)` at construction and paints each star as a tiny filled circle
 * once. Doesn't move, the camera moves past them.
 *
 * Uniform-random distribution inside a fixed extent. The escape scene's camera
 * drift over ~10 s never reaches the edge at 30 wu/s. If we ever make the
 * camera pan further, either bump `halfExtent` or add a "wrapping" mode that
 * regenerates stars ahead of the packet.
 */
export class BackgroundStarsNode extends Node2D {
  readonly #count: number
  /** Interleaved `[x, y, size, alpha]`, 4 floats per star. */
  readonly #data: Float32Array
  readonly #color: string

  constructor(opts: BackgroundStarsOptions) {
    super('background-stars')
    this.#count = opts.count
    this.#data = new Float32Array(this.#count * 4)
    this.#color = opts.color

    const [sizeMin, sizeMax] = opts.sizeWorld
    const [alphaMin, alphaMax] = opts.alphaRange
    const extent = opts.halfExtent
    for (let i = 0; i < this.#count; i++) {
      const j = i * 4
      this.#data[j] = (Math.random() * 2 - 1) * extent
      this.#data[j + 1] = (Math.random() * 2 - 1) * extent
      this.#data[j + 2] = sizeMin + Math.random() * (sizeMax - sizeMin)
      this.#data[j + 3] = alphaMin + Math.random() * (alphaMax - alphaMin)
    }
  }

  override paint(canvas: Canvas): void {
    const n = this.#count
    const d = this.#data
    const color = this.#color
    canvas.save()
    for (let i = 0; i < n; i++) {
      const j = i * 4
      canvas.setAlpha(d[j + 3])
      canvas.fillCircle(d[j], d[j + 1], d[j + 2], color)
    }
    canvas.restore()
  }
}
