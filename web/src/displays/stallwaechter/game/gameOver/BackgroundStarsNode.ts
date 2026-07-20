import { SceneNode, type Camera, type Gfx2D } from '@src/stargazer'

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
  /** Fill colour. */
  color: string
}

/**
 * A one-shot, allocation-free starfield. Populates a `Float32Array` of `(x, y,
 * size, alpha)` at construction and draws each star as a tiny filled circle
 * every frame. Doesn't move, the camera moves past them.
 *
 * Uniform-random distribution inside a fixed extent; the escape scene's camera
 * drift over ~10 s never reaches the edge at 30 wu/s. If we ever make the
 * camera pan further, either bump `halfExtent` or add a "wrapping" mode that
 * regenerates stars ahead of the packet.
 */
export class BackgroundStarsNode extends SceneNode {
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

  override draw(gfx: Gfx2D, _camera: Camera): void {
    const n = this.#count
    const d = this.#data
    const color = this.#color
    gfx.save()
    // One filled circle per star. At n = 400 this is ~400 fills/frame which
    // the Canvas backend handles comfortably; the stars are tiny (< 1 wu) so
    // the fill cost is close to zero.
    for (let i = 0; i < n; i++) {
      const j = i * 4
      gfx.setAlpha(d[j + 3])
      gfx.fillCircle(d[j], d[j + 1], d[j + 2], color)
    }
    gfx.restore()
  }
}
