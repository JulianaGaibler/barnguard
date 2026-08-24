/**
 * A hex offset per row, down the side of the buffer.
 *
 * The one place in the game that adds text rather than strokes, and it earns
 * it: the playfield is a buffer, so an address column beside it is truthful
 * rather than decorative. It is what makes the field read as a memory dump
 * instead of as a well, and it occupies the space nearest the board, which is
 * exactly where a floating pane would look worst.
 *
 * The addresses never change. Twenty short strings per seat, fixed for the life
 * of a run, so they rasterize once and stay in the label cache. A base address
 * that varied per run would look sharper and cost a full set of new labels
 * every time somebody pressed play.
 *
 * The rows the current piece is about to land on brighten, which reinforces the
 * ghost for the price of one alpha change.
 */
import { Node2D, type CameraView2D, type Gfx2D } from '@src/stargazer'
import { font } from '../../fonts'
import { textFloor } from '../layout'
import { COLORS } from '../tuning'
import type { Bounds } from '../types'

/** Bytes per row: ten cells of one machine word each. */
const ROW_STRIDE = 40

const ZERO: Bounds = { x: 0, y: 0, width: 0, height: 0 }

/** `0x` and four digits, which covers a twenty-row buffer many times over. */
function addressAt(row: number): string {
  return `0x${(row * ROW_STRIDE).toString(16).padStart(4, '0')}`
}

export class AddressGutterNode extends Node2D {
  #rect: Bounds = ZERO
  #cell = 1
  #rows = 0
  #marked: readonly number[] = []

  constructor() {
    super('bo-gutter')
    this.renderLayer = 'dynamic'
  }

  setRect(rect: Bounds, cell: number, rows: number): void {
    this.#rect = rect
    this.#cell = cell
    this.#rows = rows
    this.debugBounds = { ...rect }
  }

  /** Visible rows the falling piece would come to rest on. */
  setMarked(rows: readonly number[]): void {
    this.#marked = rows
  }

  override draw(gfx: Gfx2D, camera: CameraView2D): void {
    const r = this.#rect
    if (r.width <= 0 || this.#rows <= 0) return
    const size = Math.max(
      textFloor(camera.strokeSpaceScale()),
      this.#cell * 0.34,
    )
    const face = font(400, size)
    const right = r.x + r.width
    for (let row = 0; row < this.#rows; row++) {
      const lit = this.#marked.includes(row)
      gfx.fillText(addressAt(row), right, r.y + (row + 0.5) * this.#cell, {
        font: face,
        align: 'right',
        baseline: 'middle',
        color: lit ? COLORS.inkSoft : COLORS.ruleFaint,
      })
    }
  }
}
