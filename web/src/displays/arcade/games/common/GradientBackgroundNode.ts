import {
  Node2D,
  definePaintProps,
  type Canvas,
  type Rect,
} from 'stargazer'

/** Construction options for {@link GradientBackgroundNode}. */
export interface GradientBackgroundOptions {
  /** World rect the gradient fills. Usually a game region's visible rect. */
  rect: Rect
  /** Color at the rect's top-left corner. */
  topLeft: string
  /** Color at the rect's bottom-right corner. */
  bottomRight: string
}

/**
 * A flat two-color diagonal gradient filling a fixed world rect, top-left to
 * bottom-right. A game drops one in as the first child of its scene so it
 * paints over the shared arcade sky within the game's region, giving that game
 * its own backdrop. Reusable across games: pass the region's visible rect and
 * the two corner colors. `FlatBackgroundNode` is the single-color counterpart,
 * with the same contract.
 *
 * The rect is fixed (region-pinned), not camera-tracked: the game mounts before
 * the launcher-to-game camera pan and stays mounted through it, so a fill that
 * tracked the live view would paint over the launcher mid-pan. A rect anchored
 * to the game region scrolls into frame with the game instead. Pass the
 * region's visible rect so it covers the viewport at any aspect. Call
 * {@link setRect} to refit it.
 */
export class GradientBackgroundNode extends Node2D {
  readonly #pts = new Float32Array(8)
  readonly #topLeft: string
  readonly #bottomRight: string
  declare rectX: number
  declare rectY: number
  declare rectWidth: number
  declare rectHeight: number

  constructor(opts: GradientBackgroundOptions) {
    super('gradient-bg')
    this.#topLeft = opts.topLeft
    this.#bottomRight = opts.bottomRight
    definePaintProps(this, { rectX: 0, rectY: 0, rectWidth: 0, rectHeight: 0 })
    this.setRect(opts.rect)
  }

  /** Refit the gradient to a new world rect (e.g. after a resize). */
  setRect(rect: Rect): void {
    this.rectX = rect.x
    this.rectY = rect.y
    this.rectWidth = rect.width
    this.rectHeight = rect.height
  }

  override paint(gfx: Canvas): void {
    const x0 = this.rectX
    const y0 = this.rectY
    const x1 = x0 + this.rectWidth
    const y1 = y0 + this.rectHeight
    const pts = this.#pts
    pts[0] = x0
    pts[1] = y0
    pts[2] = x1
    pts[3] = y0
    pts[4] = x1
    pts[5] = y1
    pts[6] = x0
    pts[7] = y1
    // Axis = the rect's diagonal: top-left color at (x0, y0), bottom-right at
    // (x1, y1).
    gfx.fillPolyLinearGradient(
      pts,
      4,
      x0,
      y0,
      x1,
      y1,
      this.#topLeft,
      this.#bottomRight,
    )
  }
}
