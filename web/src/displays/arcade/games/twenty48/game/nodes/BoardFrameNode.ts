/**
 * The board itself: the plate, and the sixteen wells cut into it. Painted once
 * per geometry. The short shake a big merge gives it moves the node's
 * transform, so it never repaints.
 */
import { definePaintProps, mixColor, Node2D, type Canvas } from '@src/stargazer'
import { type BoardGeom, cellRect } from '../layout'
import { BEVEL, COLORS } from '../tuning'
import { CELLS } from '../types'
import { drawSlab, drawWell } from '../../../common/bevel'

const SHAKE_DECAY_PER_SEC = 9

export class BoardFrameNode extends Node2D {
  declare geom: BoardGeom
  #accent: string
  #shake = 0
  #shakePhase = 0

  constructor(geom: BoardGeom, accent: string) {
    super('t48-frame')
    definePaintProps(this, { geom })
    this.#accent = accent
  }

  setGeom(geom: BoardGeom): void {
    this.geom = geom
  }

  /** A short knock, for a merge worth celebrating on this board alone. */
  shake(strength: number): void {
    this.#shake = Math.max(this.#shake, strength)
  }

  override onUpdate(dt: number): void {
    if (this.#shake <= 0) return
    this.#shakePhase += dt * 46
    this.#shake = Math.max(
      0,
      this.#shake - SHAKE_DECAY_PER_SEC * dt * this.#shake,
    )
    if (this.#shake < 0.05) {
      this.#shake = 0
      this.#shakePhase = 0
    }
    this.transform.x = Math.sin(this.#shakePhase) * this.#shake
    this.transform.y = Math.cos(this.#shakePhase * 1.3) * this.#shake * 0.5
  }

  override paint(gfx: Canvas): void {
    const g = this.geom
    const cell = g.cell
    const band = cell * BEVEL.bandFrac
    const plateRadius = g.radius * 1.15

    drawSlab(gfx, {
      x: g.plate.x,
      y: g.plate.y,
      w: g.plate.width,
      h: g.plate.height,
      radius: plateRadius,
      depth: cell * BEVEL.baseDepthFrac,
      face: COLORS.plate,
      skirt: mixColor(COLORS.plate, '#000000', BEVEL.skirtMix),
      highlight: mixColor(COLORS.plate, COLORS.white, BEVEL.highlightMix * 0.6),
      band: band * 0.9,
    })

    const wellRim = mixColor(COLORS.well, '#000000', 0.14)
    for (let i = 0; i < CELLS; i++) {
      const r = cellRect(g, i)
      drawWell(
        gfx,
        r.x,
        r.y,
        r.width,
        r.height,
        g.radius,
        COLORS.well,
        wellRim,
        cell * BEVEL.wellDepthFrac,
      )
    }
  }

  /** The seat color, used by the HUD sitting above this board. */
  get accent(): string {
    return this.#accent
  }
}
