import { SceneNode, type Camera, type Gfx2D, type Rect } from '@src/stargazer'
import { REGION_WIDTH, layout } from '../world'
import { rgbaStr } from './palette'
import { visibleWorldRect } from './util'
import type { PaletteSource } from './BackgroundController'

/**
 * The world-spanning sky: one diagonal 2-stop linear gradient (bottom-right
 * `skyBottom` → top-left `skyTop`), filled over the whole VISIBLE world rect so
 * it reaches the canvas edges on any aspect. Seamless across both regions
 * (single gradient, world-anchored), so the camera pan reveals no seam.
 */
export class SkyGradientNode extends SceneNode {
  readonly #vr: Rect = { x: 0, y: 0, width: 0, height: 0 }
  readonly #pts = new Float32Array(8)
  readonly #source: PaletteSource

  constructor(source: PaletteSource) {
    super('sky')
    this.#source = source
    this.renderLayer = 'dynamic'
  }

  override draw(gfx: Gfx2D, camera: Camera): void {
    const vr = visibleWorldRect(camera, this.#vr)
    const p = this.#source.palette
    const x0 = vr.x
    const y0 = vr.y
    const x1 = vr.x + vr.width
    const y1 = vr.y + vr.height
    const pts = this.#pts
    pts[0] = x0
    pts[1] = y0
    pts[2] = x1
    pts[3] = y0
    pts[4] = x1
    pts[5] = y1
    pts[6] = x0
    pts[7] = y1
    // Gradient axis is world-fixed (bottom-right → top-left of the world), so
    // it stays put as the camera pans; the fill rect just clamps to the ends.
    gfx.fillPolyLinearGradient(
      pts,
      4,
      REGION_WIDTH,
      layout.worldHeight,
      0,
      0,
      rgbaStr(p.skyBottom),
      rgbaStr(p.skyTop),
    )
  }
}
