/**
 * The playfield: near-white background, a thin grid over it, and
 * captured-region fills that flood in with a short per-cell fade. Reads the
 * logical grid's cell bytes each frame (walls are drawn separately by their
 * WallNodes, so this only tints captured cells). Cell reveal alphas are held in
 * a parallel buffer so a freshly-captured region animates without touching the
 * logical grid.
 */
import { Node2D, type Gfx2D } from '@src/stargazer'
import type { Grid } from '../grid'
import type { FieldGeom } from '../layout'
import { CELL_FILLED, type CellRef } from '../types'
import { ANIM, COLORS } from '../tuning'

export class GridFieldNode extends Node2D {
  readonly #geom: FieldGeom
  readonly #grid: Grid
  readonly #lineW: number
  /** Reveal alpha (0..1) per cell, ramped for freshly-captured cells. */
  readonly #alpha: Float32Array

  constructor(geom: FieldGeom, grid: Grid) {
    super('grid-field')
    this.#geom = geom
    this.#grid = grid
    this.#lineW = Math.max(1, geom.cell * 0.03)
    this.#alpha = new Float32Array(grid.cols * grid.rows)
    // Draw over the arcade's dynamic sky (paint order is tree order within the
    // layer; the board subtree is added after the sky).
    this.renderLayer = 'dynamic'
    this.debugBounds = {
      x: geom.board.x,
      y: geom.board.y,
      width: geom.board.width,
      height: geom.board.height,
    }
  }

  /** Begin a flood-in for newly captured cells (alpha ramps from 0). */
  revealCells(cells: CellRef[]): void {
    for (const c of cells) this.#alpha[c.row * this.#grid.cols + c.col] = 0
  }

  /** Mark all captured cells fully revealed (no animation). */
  snapRevealed(): void {
    const cells = this.#grid.cells
    for (let i = 0; i < cells.length; i++) {
      this.#alpha[i] = cells[i] === CELL_FILLED ? 1 : 0
    }
  }

  override onUpdate(dt: number): void {
    const rate = dt / ANIM.floodReveal
    const cells = this.#grid.cells
    const alpha = this.#alpha
    for (let i = 0; i < cells.length; i++) {
      if (cells[i] === CELL_FILLED) {
        if (alpha[i] < 1) alpha[i] = Math.min(1, alpha[i] + rate)
      } else if (alpha[i] !== 0) {
        alpha[i] = 0
      }
    }
  }

  override draw(gfx: Gfx2D): void {
    const g = this.#geom
    const { cols, rows, cell } = g

    // Thick black frame (the board rect) with the light field inset inside it.
    gfx.fillRect(
      g.board.x,
      g.board.y,
      g.board.width,
      g.board.height,
      COLORS.ink,
    )
    gfx.fillRect(g.x, g.y, g.width, g.height, COLORS.field)

    // Captured cells (walls are drawn by their own nodes).
    const cells = this.#grid.cells
    const alpha = this.#alpha
    for (let row = 0; row < rows; row++) {
      for (let col = 0; col < cols; col++) {
        const i = row * cols + col
        if (cells[i] !== CELL_FILLED) continue
        const a = alpha[i]
        if (a <= 0) continue
        if (a < 1) gfx.setAlpha(a)
        gfx.fillRect(
          g.x + col * cell,
          g.y + row * cell,
          cell,
          cell,
          COLORS.captured,
        )
        if (a < 1) gfx.setAlpha(1)
      }
    }

    // Grid lines over everything.
    const lw = this.#lineW
    const half = lw / 2
    for (let c = 0; c <= cols; c++) {
      gfx.fillRect(g.x + c * cell - half, g.y, lw, g.height, COLORS.gridLine)
    }
    for (let r = 0; r <= rows; r++) {
      gfx.fillRect(
        g.x - half,
        g.y + r * cell - half,
        g.width + lw,
        lw,
        COLORS.gridLine,
      )
    }
  }
}
