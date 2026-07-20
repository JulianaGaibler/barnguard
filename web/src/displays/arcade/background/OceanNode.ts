import { SceneNode, type Camera, type Gfx2D, type Rect } from '@src/stargazer'
import { layout } from '../world'
import { rgbaStr } from './palette'
import { visibleWorldRect } from './util'
import type { PaletteSource } from './BackgroundController'

/** Ocean band height in world units (from arcade-ocean.svg: 218 of 1080). */
const BAND_HEIGHT = 218

/**
 * The ocean band at the bottom of the launcher region: a flat base fill plus a
 * "waterline" glow — a vertical gradient from the bright horizon color (top of
 * the band) down to transparent, so it stays confined to the water. Spans the
 * visible width and down to the visible bottom to cover any letterbox.
 */
export class OceanNode extends SceneNode {
  readonly #vr: Rect = { x: 0, y: 0, width: 0, height: 0 }
  readonly #pts = new Float32Array(8)
  readonly #source: PaletteSource

  constructor(source: PaletteSource) {
    super('ocean')
    this.#source = source
    this.renderLayer = 'dynamic'
  }

  override draw(gfx: Gfx2D, camera: Camera): void {
    const vr = visibleWorldRect(camera, this.#vr)
    const p = this.#source.palette
    const top = layout.worldHeight - BAND_HEIGHT
    const bottom = Math.max(layout.worldHeight, vr.y + vr.height)
    const x0 = vr.x
    const x1 = vr.x + vr.width

    gfx.fillRect(x0, top, vr.width, bottom - top, rgbaStr(p.oceanBase))

    // Vertical waterline glow: bright at the top of the band → transparent.
    const g = p.oceanGlow
    const bright = g.stops[0]
    const fade = g.stops[g.stops.length - 1]
    const pts = this.#pts
    pts[0] = x0
    pts[1] = top
    pts[2] = x1
    pts[3] = top
    pts[4] = x1
    pts[5] = bottom
    pts[6] = x0
    pts[7] = bottom
    gfx.fillPolyLinearGradient(
      pts,
      4,
      x0,
      top,
      x0,
      top + BAND_HEIGHT,
      rgbaStr(bright.color),
      rgbaStr(fade.color),
    )
  }
}
