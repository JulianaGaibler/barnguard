import { describe, expect, it } from 'vitest'
import {
  cellAt,
  clearRows,
  COLS,
  createBuffer,
  fits,
  fullRows,
  HIDDEN_ROWS,
  isBlocked,
  lockPiece,
  TOTAL_ROWS,
  VISIBLE_ROWS,
  type Buffer,
} from './board'
import type { PieceKind } from './types'

/** Fill a whole row with one shape, so it reads as a clearable line. */
const fillRow = (b: Buffer, y: number, kind: PieceKind = 'I'): void => {
  for (let x = 0; x < b.cols; x++) b.cells[y * b.cols + x] = kind
}

/** Fill a row but leave one column open. */
const fillRowExcept = (b: Buffer, y: number, gap: number): void => {
  for (let x = 0; x < b.cols; x++) {
    if (x !== gap) b.cells[y * b.cols + x] = 'O'
  }
}

describe('buffer', () => {
  it('is ten wide and twenty tall, with a spawn band above', () => {
    const b = createBuffer()
    expect(b.cols).toBe(COLS)
    expect(b.rows).toBe(TOTAL_ROWS)
    expect(TOTAL_ROWS).toBe(VISIBLE_ROWS + HIDDEN_ROWS)
    expect(b.cells.every((c) => c === null)).toBe(true)
  })

  it('reads out of bounds as empty', () => {
    const b = createBuffer()
    expect(cellAt(b, -1, 0)).toBeNull()
    expect(cellAt(b, COLS, 0)).toBeNull()
    expect(cellAt(b, 0, TOTAL_ROWS)).toBeNull()
  })
})

describe('blocking', () => {
  it('treats the walls and the floor as solid', () => {
    const b = createBuffer()
    expect(isBlocked(b, -1, 5)).toBe(true)
    expect(isBlocked(b, COLS, 5)).toBe(true)
    expect(isBlocked(b, 0, TOTAL_ROWS)).toBe(true)
  })

  it('lets a piece stick up through the ceiling', () => {
    // A kick has to be able to lift a piece clear of the stack, which it cannot
    // do if the space above the spawn band counts as solid.
    const b = createBuffer()
    expect(isBlocked(b, 4, -1)).toBe(false)
    expect(isBlocked(b, 4, -5)).toBe(false)
  })
})

describe('fitting and locking', () => {
  it('rejects a placement overlapping a filled cell', () => {
    const b = createBuffer()
    b.cells[5 * COLS + 4] = 'Z'
    expect(fits(b, 'O', 0, 4, 5)).toBe(false)
    expect(fits(b, 'O', 0, 6, 5)).toBe(true)
  })

  it('rejects a placement running off the side', () => {
    const b = createBuffer()
    expect(fits(b, 'I', 0, 7, 5)).toBe(false)
    expect(fits(b, 'I', 0, 6, 5)).toBe(true)
  })

  it('writes exactly four cells', () => {
    const b = createBuffer()
    lockPiece(b, 'T', 0, 3, 4)
    expect(b.cells.filter((c) => c !== null)).toHaveLength(4)
    expect(cellAt(b, 4, 4)).toBe('T')
    expect(cellAt(b, 3, 5)).toBe('T')
  })

  it('drops cells that would land above the ceiling', () => {
    const b = createBuffer()
    // The T's nub sits a row above its bar, so at y = -1 only the bar lands.
    lockPiece(b, 'T', 0, 3, -1)
    expect(b.cells.filter((c) => c !== null)).toHaveLength(3)
  })
})

describe('full rows', () => {
  it('finds none in an empty buffer', () => {
    expect(fullRows(createBuffer())).toEqual([])
  })

  it('ignores a row with a gap', () => {
    const b = createBuffer()
    fillRowExcept(b, 10, 3)
    expect(fullRows(b)).toEqual([])
  })

  it('lists full rows top to bottom', () => {
    const b = createBuffer()
    fillRow(b, 12)
    fillRow(b, 18)
    fillRow(b, 15)
    expect(fullRows(b)).toEqual([12, 15, 18])
  })
})

describe('clearing', () => {
  it('does nothing when nothing is full', () => {
    const b = createBuffer()
    b.cells[8 * COLS + 2] = 'S'
    clearRows(b, [])
    expect(cellAt(b, 2, 8)).toBe('S')
  })

  it('drops the stack onto a cleared row', () => {
    const b = createBuffer()
    b.cells[9 * COLS + 0] = 'J'
    fillRow(b, 10)
    clearRows(b, [10])
    expect(cellAt(b, 0, 9)).toBeNull()
    expect(cellAt(b, 0, 10)).toBe('J')
    expect(fullRows(b)).toEqual([])
  })

  it('collapses four rows at once, keeping what sat above them', () => {
    const b = createBuffer()
    b.cells[14 * COLS + 7] = 'L'
    for (let y = 15; y <= 18; y++) fillRow(b, y)
    clearRows(b, [15, 16, 17, 18])
    // The marker fell all four rows and nothing else survived.
    expect(cellAt(b, 7, 18)).toBe('L')
    expect(b.cells.filter((c) => c !== null)).toHaveLength(1)
  })

  it('handles non-adjacent rows in one pass', () => {
    const b = createBuffer()
    b.cells[10 * COLS + 1] = 'S'
    fillRow(b, 11)
    b.cells[12 * COLS + 2] = 'Z'
    fillRow(b, 13)
    clearRows(b, [11, 13])
    // Both markers dropped by the number of cleared rows below each of them.
    expect(cellAt(b, 1, 12)).toBe('S')
    expect(cellAt(b, 2, 13)).toBe('Z')
    expect(b.cells.filter((c) => c !== null)).toHaveLength(2)
  })

  it('empties the buffer when every row goes', () => {
    const b = createBuffer()
    const rows: number[] = []
    for (let y = 0; y < TOTAL_ROWS; y++) {
      fillRow(b, y)
      rows.push(y)
    }
    clearRows(b, rows)
    expect(b.cells.every((c) => c === null)).toBe(true)
  })
})
