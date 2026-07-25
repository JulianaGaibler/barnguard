import { SceneNode, type Gfx2D, type Rect } from '@src/stargazer'

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
 * the two corner colors.
 *
 * The rect is fixed (region-pinned), not camera-tracked: the game mounts before
 * the launcher-to-game camera pan and stays mounted through it, so a fill that
 * tracked the live view would paint over the launcher mid-pan. A rect anchored
 * to the game region scrolls into frame with the game instead. Pass the
 * region's visible rect so it covers the viewport at any aspect; call
 * {@link setRect} to refit it.
 */
export class GradientBackgroundNode extends SceneNode {
  readonly #rect: Rect = { x: 0, y: 0, width: 0, height: 0 }
  readonly #pts = new Float32Array(8)
  #topLeft: string
  #bottomRight: string

  constructor(opts: GradientBackgroundOptions) {
    super('gradient-bg')
    this.#topLeft = opts.topLeft
    this.#bottomRight = opts.bottomRight
    this.setRect(opts.rect)
    // Dynamic so it draws in the same pass as the shared sky; the game subtree
    // is added after the sky, so this paints over it within the game view.
    this.renderLayer = 'dynamic'
  }

  /** Refit the gradient to a new world rect (e.g. after a resize). */
  setRect(rect: Rect): void {
    this.#rect.x = rect.x
    this.#rect.y = rect.y
    this.#rect.width = rect.width
    this.#rect.height = rect.height
  }

  override draw(gfx: Gfx2D): void {
    const r = this.#rect
    const x0 = r.x
    const y0 = r.y
    const x1 = r.x + r.width
    const y1 = r.y + r.height
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
