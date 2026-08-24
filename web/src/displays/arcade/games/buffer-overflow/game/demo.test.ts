/**
 * The demo scripts' geometry, checked without a canvas.
 *
 * Every failure these catch shows up the same way in a browser: a card that
 * animates nothing, or animates it somewhere the card does not cover. That is
 * invisible to a type check and easy to miss in a run-through, since a still
 * card looks like a still card by design.
 */
import { describe, expect, it } from 'vitest'
import { fullRows, HIDDEN_ROWS, VISIBLE_TOP, visibleRows } from './board'
import {
  createDemoBuffer,
  DEMO_COLS,
  DEMO_FLOOR,
  DEMO_ROWS,
  enterPiece,
} from './demo'
import { PIECE_KINDS, pieceCells } from './pieces'
import { commit, hardDropTarget, type ActivePiece } from './rules'

/** The rows a piece actually occupies. */
const rowsOf = (p: ActivePiece): number[] =>
  pieceCells(p.kind, p.rot).map((c) => p.y + c.y)

/** The columns a piece actually occupies. */
const colsOf = (p: ActivePiece): number[] =>
  pieceCells(p.kind, p.rot).map((c) => p.x + c.x)

describe('the card buffer', () => {
  it('is a real buffer, just smaller than the game one', () => {
    const b = createDemoBuffer()
    expect(b.cols).toBe(DEMO_COLS)
    expect(visibleRows(b)).toBe(DEMO_ROWS)
    expect(b.rows).toBe(HIDDEN_ROWS + DEMO_ROWS)
    expect(b.cells).toHaveLength(DEMO_COLS * (HIDDEN_ROWS + DEMO_ROWS))
  })

  it('puts its floor at the bottom of what the card draws', () => {
    // The whole reason the card builds its own size rather than cropping the
    // game's: a taller buffer's floor would sit below the card and swallow
    // every drop.
    expect(DEMO_FLOOR).toBe(createDemoBuffer().rows - 1)
  })

  it('is narrow enough to read at card size', () => {
    expect(DEMO_COLS).toBeLessThan(10)
  })
})

describe('entering a piece', () => {
  it('brings every shape into the drawn window', () => {
    // A piece left in the spawn band is not drawn at all, so a card that
    // skipped this would sit blank until its first drop.
    for (const kind of PIECE_KINDS) {
      const b = createDemoBuffer()
      const rows = rowsOf(enterPiece(b, kind))
      expect(
        Math.min(...rows),
        `${kind} still has cells above the rim`,
      ).toBeGreaterThanOrEqual(VISIBLE_TOP)
    }
  })

  it('keeps every shape inside the narrower buffer', () => {
    for (const kind of PIECE_KINDS) {
      const b = createDemoBuffer()
      const cols = colsOf(enterPiece(b, kind))
      expect(Math.min(...cols), `${kind} left`).toBeGreaterThanOrEqual(0)
      expect(Math.max(...cols), `${kind} right`).toBeLessThan(DEMO_COLS)
    }
  })

  it('leaves every shape room to fall before it lands', () => {
    // A card whose piece enters already grounded shows no motion at all.
    for (const kind of PIECE_KINDS) {
      const b = createDemoBuffer()
      const entered = enterPiece(b, kind)
      expect(hardDropTarget(b, entered).y, `${kind}`).toBeGreaterThan(entered.y)
    }
  })
})

describe('dropping', () => {
  it('lands every shape on the card floor', () => {
    for (const kind of PIECE_KINDS) {
      const b = createDemoBuffer()
      const landed = hardDropTarget(b, enterPiece(b, kind))
      expect(Math.max(...rowsOf(landed)), `${kind}`).toBe(DEMO_FLOOR)
    }
  })
})

describe('the flush card', () => {
  it('actually clears four rows', () => {
    // A scripted flush that turns out not to fill the rows leaves the card
    // flashing at nothing, which reads as a bug rather than as a lesson.
    const b = createDemoBuffer()
    const rows = [DEMO_FLOOR, DEMO_FLOOR - 1, DEMO_FLOOR - 2, DEMO_FLOOR - 3]
    const gap = DEMO_COLS - 1
    for (const row of rows) {
      for (let x = 0; x < DEMO_COLS; x++) {
        if (x !== gap) b.cells[row * DEMO_COLS + x] = 'Z'
      }
    }
    expect(fullRows(b)).toEqual([])

    // The upright bar, walked over the open column and dropped.
    let bar = enterPiece(b, 'I')
    bar = { ...bar, rot: 1 }
    while (Math.max(...colsOf(bar)) < gap) bar = { ...bar, x: bar.x + 1 }
    commit(b, hardDropTarget(b, bar))

    expect(fullRows(b).sort((a, c) => a - c)).toEqual(
      [...rows].sort((a, c) => a - c),
    )
  })
})
