/**
 * The board itself: the plate, and the sixteen wells cut into it. Static, so it
 * draws in one pass and never animates except for the short shake a big merge
 * gives it.
 */
import { mixColor, Node2D, type Gfx2D } from '@src/stargazer'
import { type BoardGeom, cellRect } from '../layout'
import { BEVEL, COLORS } from '../tuning'
import { CELLS } from '../types'
import { drawSlab, drawWell } from './bevel'

const SHAKE_DECAY_PER_SEC = 9

export class BoardFrameNode extends Node2D {
  #geom: BoardGeom
  #accent: string
  #shake = 0
  #shakePhase = 0

  constructor(geom: BoardGeom, accent: string) {
    super('t48-frame')
    this.renderLayer = 'dynamic'
    this.#geom = geom
    this.#accent = accent
    this.#refit()
  }

  setGeom(geom: BoardGeom): void {
    this.#geom = geom
    this.#refit()
  }

  /** A short knock, for a merge worth celebrating on this board alone. */
  shake(strength: number): void {
    this.#shake = Math.max(this.#shake, strength)
  }

  #refit(): void {
    const s = this.#geom.slot
    this.debugBounds = { x: s.x, y: s.y, width: s.width, height: s.height }
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
  }

  override draw(gfx: Gfx2D): void {
    const g = this.#geom
    const cell = g.cell
    const band = cell * BEVEL.bandFrac
    const plateRadius = g.radius * 1.15

    if (this.#shake > 0) {
      gfx.save()
      gfx.translate(
        Math.sin(this.#shakePhase) * this.#shake,
        Math.cos(this.#shakePhase * 1.3) * this.#shake * 0.5,
      )
    }

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

    if (this.#shake > 0) gfx.restore()
  }

  /** The seat color, used by the HUD sitting above this board. */
  get accent(): string {
    return this.#accent
  }
}
