import {
  Node2D,
  definePaintProps,
  type Canvas,
  type Rect,
} from '@src/stargazer'

/** Construction options for {@link FlatBackgroundNode}. */
export interface FlatBackgroundOptions {
  /** World rect the fill covers. Usually a game region's visible rect. */
  rect: Rect
  /** The fill color. */
  color: string
}

/**
 * A single-color fill covering a fixed world rect. A game drops one in as the
 * first child of its scene so it paints over the shared arcade sky within the
 * game's region, giving that game its own backdrop. Reusable across games: pass
 * the region's visible rect and one color.
 *
 * The flat counterpart to `GradientBackgroundNode`, with the same contract.
 * Reach for this one when the backdrop is a solid: two identical stops would
 * pay for a gradient fill to draw something a rect fill already does.
 *
 * The rect is fixed (region-pinned), not camera-tracked: the game mounts before
 * the launcher-to-game camera pan and stays mounted through it, so a fill that
 * tracked the live view would paint over the launcher mid-pan. A rect anchored
 * to the game region scrolls into frame with the game instead. Pass the
 * region's visible rect so it covers the viewport at any aspect. Call
 * {@link setRect} to refit it.
 */
export class FlatBackgroundNode extends Node2D {
  readonly #color: string
  declare rectX: number
  declare rectY: number
  declare rectWidth: number
  declare rectHeight: number

  constructor(opts: FlatBackgroundOptions) {
    super('flat-bg')
    this.#color = opts.color
    definePaintProps(this, { rectX: 0, rectY: 0, rectWidth: 0, rectHeight: 0 })
    this.setRect(opts.rect)
  }

  /** Refit the fill to a new world rect (e.g. after a resize). */
  setRect(rect: Rect): void {
    this.rectX = rect.x
    this.rectY = rect.y
    this.rectWidth = rect.width
    this.rectHeight = rect.height
  }

  override paint(gfx: Canvas): void {
    gfx.fillRect(
      this.rectX,
      this.rectY,
      this.rectWidth,
      this.rectHeight,
      this.#color,
    )
  }
}
