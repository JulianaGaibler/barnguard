import { Node2D, type Canvas } from '@src/stargazer'

/**
 * Solid backdrop for the game region. Fills the camera's visible world rect so
 * the shared arcade sky can never leak in when the camera zooms into a state.
 * The zoom framings deliberately overshoot above the map for headroom, which a
 * fixed region-sized rect fails to cover.
 *
 * The bottom edge is pinned to the game region's bottom so it never paints over
 * the launcher region below: as the arcade pans between the launcher and the
 * game the backdrop scrolls away instead of blacking out the launcher. Top and
 * sides follow the visible rect, covering the framing headroom above the map.
 * Rides the camera like `SkyGradientNode`.
 */
export class BackdropNode extends Node2D {
  readonly #regionBottom: number
  readonly #fill: string

  constructor(opts: { regionBottom: number; fill: string }) {
    super('data-control-backdrop')
    this.#regionBottom = opts.regionBottom
    this.#fill = opts.fill
  }

  override paint(canvas: Canvas): void {
    const vr = canvas.visibleWorldRect()
    const top = vr.y
    const bottom = Math.min(vr.y + vr.height, this.#regionBottom)
    if (bottom <= top) return
    canvas.fillRect(vr.x, top, vr.width, bottom - top, this.#fill)
  }
}
