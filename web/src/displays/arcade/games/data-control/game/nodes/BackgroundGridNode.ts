import {
  Node2D,
  type CameraView2D,
  type Gfx2D,
  type Rect,
} from '@src/stargazer'

/**
 * A blue reference grid drawn across a world rect, sitting behind the map on
 * the black backdrop. Lives at the node origin and draws in world coordinates
 * (identity transform), so it rides the camera and scales with any zoom. Line
 * width is in screen space so the strokes stay a constant thickness regardless
 * of the camera framing.
 */
export class BackgroundGridNode extends Node2D {
  #rect: Rect
  readonly #cell: number
  readonly #color: string
  readonly #lineWidthPx: number

  constructor(opts: {
    rect: Rect
    cell: number
    color: string
    lineWidthPx?: number
  }) {
    super('data-control-grid')
    this.#rect = { ...opts.rect }
    this.#cell = opts.cell
    this.#color = opts.color
    this.#lineWidthPx = opts.lineWidthPx ?? 1.5
    this.renderLayer = 'static'
  }

  /** Refit the grid to a new region rect (on resize). */
  setRect(rect: Rect): void {
    this.#rect = { ...rect }
  }

  override draw(gfx: Gfx2D, camera: CameraView2D): void {
    const r = this.#rect
    const cell = this.#cell
    if (cell <= 0) return
    const style = {
      color: this.#color,
      width: this.#lineWidthPx * camera.strokeSpaceScale(),
    }
    const right = r.x + r.width
    const bottom = r.y + r.height
    // Snap to the cell lattice so the lines don't crawl as the rect origin
    // shifts on resize.
    const x0 = Math.ceil(r.x / cell) * cell
    for (let x = x0; x <= right; x += cell) {
      gfx.strokeLine(x, r.y, x, bottom, style)
    }
    const y0 = Math.ceil(r.y / cell) * cell
    for (let y = y0; y <= bottom; y += cell) {
      gfx.strokeLine(r.x, y, right, y, style)
    }
  }
}
