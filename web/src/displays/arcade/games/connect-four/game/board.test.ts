import { describe, expect, it } from 'vitest'
import {
  COLS,
  ROWS,
  cloneBoard,
  createBoard,
  dropRow,
  isFull,
  legalColumns,
  makeMove,
  unmakeMove,
  winningCells,
  type Board,
} from './board'
import type { Player } from './types'

/** Build a board from bottom-to-top column stacks; leaves `winner` at 0. */
function build(columns: number[][], turn: Player = 1): Board {
  const b = createBoard()
  for (let c = 0; c < columns.length; c++) {
    for (let r = 0; r < columns[c].length; r++) {
      const p = columns[c][r]
      b.cells[r * COLS + c] = p
      b.heights[c] = r + 1
      if (p !== 0) b.ply += 1
    }
  }
  b.turn = turn
  return b
}

/** Play a specific player's disc regardless of whose turn it is. */
function force(b: Board, col: number, player: Player): void {
  b.turn = player
  makeMove(b, col)
}

describe('connect four board', () => {
  it('drops land bottom-up and reject a full column', () => {
    const b = createBoard()
    expect(dropRow(b, 3)).toBe(0)
    for (let i = 0; i < ROWS; i++) force(b, 3, 1)
    expect(dropRow(b, 3)).toBeNull()
    expect(legalColumns(b)).not.toContain(3)
  })

  it('detects a horizontal win', () => {
    const b = createBoard()
    force(b, 0, 1)
    force(b, 1, 1)
    force(b, 2, 1)
    expect(b.winner).toBe(0)
    force(b, 3, 1)
    expect(b.winner).toBe(1)
    expect(winningCells(b, 3, 0)?.length).toBeGreaterThanOrEqual(4)
  })

  it('detects a vertical win', () => {
    const b = createBoard()
    for (let i = 0; i < 3; i++) force(b, 2, 2)
    expect(b.winner).toBe(0)
    force(b, 2, 2)
    expect(b.winner).toBe(2)
  })

  it('detects a diagonal win', () => {
    // Stair-step so player 1 owns (0,0),(1,1),(2,2),(3,3).
    const b = build([
      [1], // col0 row0 = 1
      [2, 1], // col1: row0=2, row1=1
      [2, 2, 1], // col2: rows 0,1=2, row2=1
      [2, 2, 2], // col3: rows 0,1,2 = 2 (row3 open)
    ])
    force(b, 3, 1) // lands row3 → completes the diagonal
    expect(b.winner).toBe(1)
    expect(winningCells(b, 3, 3)?.length).toBeGreaterThanOrEqual(4)
  })

  it('make/unmake restores the board exactly', () => {
    const b = createBoard()
    const before = cloneBoard(b)
    makeMove(b, 3)
    makeMove(b, 3)
    makeMove(b, 4)
    unmakeMove(b, 4)
    unmakeMove(b, 3)
    unmakeMove(b, 3)
    expect([...b.cells]).toEqual([...before.cells])
    expect([...b.heights]).toEqual([...before.heights])
    expect(b.turn).toBe(before.turn)
    expect(b.ply).toBe(before.ply)
    expect(b.winner).toBe(before.winner)
  })

  it('reports a full board', () => {
    // Fill without ever making four in a row by using a color pattern that
    // shifts every two columns (a standard no-win fill).
    const pattern: Player[][] = []
    for (let c = 0; c < COLS; c++) {
      const colVals: Player[] = []
      for (let r = 0; r < ROWS; r++) {
        const band = Math.floor(r / 2) + Math.floor(c / 1)
        colVals.push(((band % 2) + 1) as Player)
      }
      pattern.push(colVals)
    }
    const b2 = build(pattern)
    expect(isFull(b2)).toBe(true)
    expect(legalColumns(b2)).toHaveLength(0)
  })
})
