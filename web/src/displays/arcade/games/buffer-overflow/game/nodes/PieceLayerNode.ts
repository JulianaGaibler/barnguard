/**
 * The piece in play and its ghost, drawn over the buffer.
 *
 * Its own node rather than part of {@link BufferNode} so it paints after the
 * locked stack without either having to sort, and so a hard drop's squash can
 * scale the falling piece alone.
 *
 * Cells above the rim are clipped away by simply not drawing them: a piece
 * spawns in a hidden band two rows deep, and the part still up there has not
 * entered play yet.
 */
import { easings, Node2D, type Canvas } from '@src/stargazer'
import { pieceCells } from '../pieces'
import { VISIBLE_TOP } from '../board'
import type { ActivePiece } from '../rules'
import { ANIM } from '../tuning'
import type { Bounds } from '../types'
import { sameBounds } from './tui'
import { drawCell, drawGhostCell } from './cells'

function samePiece(a: ActivePiece | null, b: ActivePiece | null): boolean {
  if (a === b) return true
  if (!a || !b) return false
  return a.kind === b.kind && a.rot === b.rot && a.x === b.x && a.y === b.y
}

/** How solid the ghost reads against the buffer. */
const GHOST_ALPHA = 0.42

export class PieceLayerNode extends Node2D {
  #rect: Bounds = { x: 0, y: 0, width: 0, height: 0 }
  #cell = 1
  #piece: ActivePiece | null = null
  #ghost: ActivePiece | null = null
  #showGhost = true

  /**
   * Runs 0 to 1 after a hard drop, squashing the piece as it bites. The squash
   * is a different picture every frame, so the layer paints each frame it
   * runs.
   */
  #squashT = 1

  constructor() {
    super('bo-piece-layer')
  }

  setRect(rect: Bounds, cell: number): void {
    if (sameBounds(rect, this.#rect) && cell === this.#cell) return
    this.#rect = { ...rect }
    this.#cell = cell
    this.markNeedsPaint()
  }

  /** The session mutates its pieces in place, so the layer keeps copies. */
  setPiece(piece: ActivePiece | null, ghost: ActivePiece | null): void {
    if (samePiece(piece, this.#piece) && samePiece(ghost, this.#ghost)) return
    this.#piece = piece && { ...piece }
    this.#ghost = ghost && { ...ghost }
    this.markNeedsPaint()
  }

  setGhostVisible(visible: boolean): void {
    if (visible === this.#showGhost) return
    this.#showGhost = visible
    this.markNeedsPaint()
  }

  /** Squash the piece against the stack, for a drop that arrived fast. */
  impact(): void {
    this.#squashT = 0
    this.markNeedsPaint()
  }

  override onUpdate(dt: number): void {
    if (this.#squashT >= 1) return
    this.#squashT = Math.min(
      1,
      this.#squashT + dt / (ANIM.landSquash + ANIM.landRecover),
    )
    this.markNeedsPaint()
  }

  override paint(gfx: Canvas): void {
    const piece = this.#piece
    if (!piece || this.#cell <= 0) return
    const cell = this.#cell

    if (this.#showGhost && this.#ghost && this.#ghost.y !== piece.y) {
      this.#drawCells(gfx, this.#ghost, cell, true)
    }

    // The squash is a vertical scale about the piece's own footing, so it reads
    // as the piece taking the impact rather than the whole board moving.
    const squash = this.#squashLevel()
    if (squash === 0) {
      this.#drawCells(gfx, piece, cell, false)
      return
    }
    const cells = pieceCells(piece.kind, piece.rot)
    const bottom =
      this.#rect.y +
      (piece.y + Math.max(...cells.map((c) => c.y)) + 1 - VISIBLE_TOP) * cell
    gfx.save()
    gfx.translate(0, bottom)
    gfx.scale(1 + squash * 0.5, 1 - squash)
    gfx.translate(0, -bottom)
    this.#drawCells(gfx, piece, cell, false)
    gfx.restore()
  }

  /** Squash amount now: a quick bite, then an eased recovery. */
  #squashLevel(): number {
    if (this.#squashT >= 1) return 0
    const span = ANIM.landSquash / (ANIM.landSquash + ANIM.landRecover)
    if (this.#squashT < span) {
      return easings.outQuad(this.#squashT / span) * ANIM.landSquash
    }
    const back = (this.#squashT - span) / (1 - span)
    return (1 - easings.outCubic(back)) * ANIM.landSquash
  }

  #drawCells(
    gfx: Canvas,
    piece: ActivePiece,
    cell: number,
    ghost: boolean,
  ): void {
    for (const c of pieceCells(piece.kind, piece.rot)) {
      const row = piece.y + c.y
      // Still in the spawn band, so not yet the player's problem to see.
      if (row < VISIBLE_TOP) continue
      const x = this.#rect.x + (piece.x + c.x) * cell
      const y = this.#rect.y + (row - VISIBLE_TOP) * cell
      if (ghost) drawGhostCell(gfx, piece.kind, x, y, cell, GHOST_ALPHA)
      else drawCell(gfx, piece.kind, x, y, cell)
    }
  }
}
