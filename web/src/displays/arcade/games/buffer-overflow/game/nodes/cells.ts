/**
 * Drawing one cell, and drawing a whole piece out of them.
 *
 * Every filled cell in the game goes through here, whether it is locked in the
 * buffer, falling, sitting in the hold pocket or previewing in the queue. One
 * function means a piece looks the same everywhere it appears, which is what
 * lets a player read the queue at a glance.
 */
import type { Gfx2D } from '@src/stargazer'
import { pieceCells } from '../pieces'
import { FRAME, PIECE_COLORS, pieceHighlight, pieceSkirt } from '../tuning'
import type { PieceKind, Rotation } from '../types'

/**
 * One filled cell as a shaded block.
 *
 * Square, with a lit rule along the top and left and a shaded one along the
 * bottom and right. That is how a terminal shades a block, and it keeps every
 * piece its own colour while dropping the arcade gloss the rest of the screen
 * has given up.
 *
 * Three quads, laid largest first so each one leaves a rule of the last
 * showing: the lit tint fills the cell, the shade covers it offset down and
 * right, and the face covers that inset on all four sides. Same cost as the
 * bevelled slab this replaces.
 *
 * `size` is the whole cell, so a stack sits flush inside its grid without any
 * cell overflowing into the one below.
 *
 * @remarks
 *   `fillRoundRect` at radius zero rather than `fillRect`, throughout. The two
 *   run on different programs, and mixing them per cell would break the batch
 *   that holds the whole playfield, its frame and its labels in one draw.
 */
export function drawCell(
  gfx: Gfx2D,
  kind: PieceKind,
  x: number,
  y: number,
  size: number,
): void {
  const w = Math.max(1, gfx.snapSize(size * FRAME.cellRuleFrac))
  gfx.fillRoundRect(x, y, size, size, 0, pieceHighlight(kind))
  gfx.fillRoundRect(x + w, y + w, size - w, size - w, 0, pieceSkirt(kind))
  gfx.fillRoundRect(
    x + w,
    y + w,
    size - w * 2,
    size - w * 2,
    0,
    PIECE_COLORS[kind],
  )
}

/**
 * The outline a piece would occupy if dropped, drawn as a dashed marquee.
 *
 * Stroked and never filled. A translucent fill would double-blend wherever two
 * of the piece's own cells touch, and the seam would read as a crease through
 * the shape.
 *
 * Dashed rather than solid, which is how a terminal marks a selection that is
 * not committed yet. It also tells the ghost apart from a locked block at a
 * glance, which a solid outline at low alpha does not.
 */
export function drawGhostCell(
  gfx: Gfx2D,
  kind: PieceKind,
  x: number,
  y: number,
  size: number,
  alpha: number,
): void {
  const inset = size * 0.12
  const dash = size * 0.22
  gfx.setAlpha(alpha)
  gfx.strokeRoundRect(
    x + inset,
    y + inset,
    size - inset * 2,
    size - inset * 2,
    0,
    {
      color: PIECE_COLORS[kind],
      width: Math.max(1, size * 0.07),
      dash: [dash, dash],
    },
  )
  gfx.setAlpha(1)
}

/** Every cell of a piece, with its box's top-left at `(originX, originY)`. */
function drawPiece(
  gfx: Gfx2D,
  kind: PieceKind,
  rot: Rotation,
  originX: number,
  originY: number,
  size: number,
): void {
  for (const c of pieceCells(kind, rot)) {
    drawCell(gfx, kind, originX + c.x * size, originY + c.y * size, size)
  }
}

/** A piece's occupied extent at `rot`, in cells. */
function pieceExtent(
  kind: PieceKind,
  rot: Rotation,
): { minX: number; minY: number; width: number; height: number } {
  const cells = pieceCells(kind, rot)
  let minX = Infinity
  let minY = Infinity
  let maxX = -Infinity
  let maxY = -Infinity
  for (const c of cells) {
    if (c.x < minX) minX = c.x
    if (c.y < minY) minY = c.y
    if (c.x > maxX) maxX = c.x
    if (c.y > maxY) maxY = c.y
  }
  return { minX, minY, width: maxX - minX + 1, height: maxY - minY + 1 }
}

/**
 * A piece centred in a box, at whatever cell size fits.
 *
 * Centred on its filled cells rather than on its bounding box, so the flat four
 * and the square both sit in the middle of a preview pocket instead of hanging
 * off one edge.
 */
export function drawPieceCentered(
  gfx: Gfx2D,
  kind: PieceKind,
  boxX: number,
  boxY: number,
  boxW: number,
  boxH: number,
  maxCell: number,
): void {
  const e = pieceExtent(kind, 0)
  const size = Math.min(maxCell, boxW / e.width, boxH / e.height)
  const originX = boxX + (boxW - e.width * size) / 2 - e.minX * size
  const originY = boxY + (boxH - e.height * size) / 2 - e.minY * size
  drawPiece(gfx, kind, 0, originX, originY, size)
}
