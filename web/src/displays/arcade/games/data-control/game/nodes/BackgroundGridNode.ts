import { Node2D, type Canvas } from 'stargazer'

/**
 * A green reference grid drawn on the black backdrop, behind the map. Lives at
 * the node origin and draws in world coordinates (identity transform), so it
 * rides the camera and scales with any zoom. Line width is in screen space so
 * the strokes stay a constant thickness regardless of the camera framing.
 *
 * Like {@link import('./BackdropNode').BackdropNode} it fills the camera's
 * visible world rect (bottom pinned to the game region) so the grid follows the
 * camera into any zoom (including the framing headroom above the map) instead
 * of leaving a bare strip, while never spilling into the launcher region
 * below.
 */
export class BackgroundGridNode extends Node2D {
  readonly #cell: number
  readonly #color: string
  readonly #lineWidthPx: number
  readonly #regionBottom: number

  constructor(opts: {
    cell: number
    color: string
    regionBottom: number
    lineWidthPx?: number
  }) {
    super('data-control-grid')
    this.#cell = opts.cell
    this.#color = opts.color
    this.#regionBottom = opts.regionBottom
    this.#lineWidthPx = opts.lineWidthPx ?? 1.5
  }

  override paint(canvas: Canvas): void {
    const cell = this.#cell
    if (cell <= 0) return
    const vr = canvas.visibleWorldRect()
    const left = vr.x
    const right = vr.x + vr.width
    const top = vr.y
    const bottom = Math.min(vr.y + vr.height, this.#regionBottom)
    if (bottom <= top) return
    const style = {
      color: this.#color,
      width: this.#lineWidthPx * canvas.screenScale(),
    }
    // Snap to the cell lattice so the lines don't crawl as the view shifts.
    const x0 = Math.ceil(left / cell) * cell
    for (let x = x0; x <= right; x += cell) {
      canvas.strokeLine(x, top, x, bottom, style)
    }
    const y0 = Math.ceil(top / cell) * cell
    for (let y = y0; y <= bottom; y += cell) {
      canvas.strokeLine(left, y, right, y, style)
    }
  }
}
