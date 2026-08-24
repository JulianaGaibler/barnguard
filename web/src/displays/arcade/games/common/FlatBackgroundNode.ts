import { Node2D, type Gfx2D, type Rect } from '@src/stargazer'

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
  readonly #rect: Rect = { x: 0, y: 0, width: 0, height: 0 }
  readonly #color: string

  constructor(opts: FlatBackgroundOptions) {
    super('flat-bg')
    this.#color = opts.color
    this.setRect(opts.rect)
    // Dynamic so it draws in the same pass as the shared sky. The game subtree
    // is added after the sky, so this paints over it within the game view.
    this.renderLayer = 'dynamic'
  }

  /** Refit the fill to a new world rect (e.g. after a resize). */
  setRect(rect: Rect): void {
    this.#rect.x = rect.x
    this.#rect.y = rect.y
    this.#rect.width = rect.width
    this.#rect.height = rect.height
  }

  override draw(gfx: Gfx2D): void {
    const r = this.#rect
    gfx.fillRect(r.x, r.y, r.width, r.height, this.#color)
  }
}
