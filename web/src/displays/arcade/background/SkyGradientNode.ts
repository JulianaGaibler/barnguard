import { Node2D, type Camera, type Gfx2D, type Rect } from '@src/stargazer'
import { rgbaStr } from './palette'
import { visibleWorldRect } from './util'
import type { PaletteSource } from './BackgroundController'

/**
 * The sky: one diagonal 2-stop linear gradient (bottom-right `skyBottom` →
 * top-left `skyTop`) mapped across the VISIBLE rect, so every screen shows the
 * full range on any aspect. The axis tracks the view each frame, so the fill
 * always spans a complete `skyTop`→`skyBottom` gradient with no seam during the
 * camera pan.
 */
export class SkyGradientNode extends Node2D {
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
    // Gradient axis = the visible rect's diagonal (bottom-right `skyBottom` →
    // top-left `skyTop`), so the full range maps across whatever is on screen.
    gfx.fillPolyLinearGradient(
      pts,
      4,
      x1,
      y1,
      x0,
      y0,
      rgbaStr(p.skyBottom),
      rgbaStr(p.skyTop),
    )
  }
}
