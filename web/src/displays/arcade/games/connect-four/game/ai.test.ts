import { describe, expect, it } from 'vitest'
import { COLS, ROWS, createBoard, legalColumns, type Board } from './board'
import { chooseColumn } from './ai'
import type { Player } from './types'

function build(columns: number[][], turn: Player): Board {
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

describe('connect four AI', () => {
  it('takes an immediate win', () => {
    // Player 1 (to move) has three across on the bottom row; col 3 wins.
    const b = build([[1], [1], [1]], 1)
    expect(chooseColumn(b, 'medium')).toBe(3)
  })

  it('blocks the opponent immediate win', () => {
    // Player 2 threatens 0-1-2-3 on the bottom row; player 1 (to move, no win of
    // its own) must play column 3.
    const b = build([[2], [2], [2]], 1)
    expect(chooseColumn(b, 'hard')).toBe(3)
  })

  it('easy takes its random-blunder branch when the roll is low', () => {
    const b = build([[2], [2], [2]], 1)
    // random() < blunderChance(0.3) → random legal move (not the search).
    const col = chooseColumn(b, 'easy', () => 0.1)
    expect(legalColumns(b)).toContain(col)
  })

  it('returns a legal column and never mutates the live board', () => {
    const b = createBoard()
    const snapshot = [...b.cells]
    const col = chooseColumn(b, 'medium')
    expect(col).toBeGreaterThanOrEqual(0)
    expect(col).toBeLessThan(COLS)
    expect([...b.cells]).toEqual(snapshot)
    expect(b.ply).toBe(0)
  })

  it('reports -1 on a full board', () => {
    const full: number[][] = []
    for (let c = 0; c < COLS; c++) {
      const colVals: number[] = []
      for (let r = 0; r < ROWS; r++)
        colVals.push(((Math.floor(r / 2) + c) % 2) + 1)
      full.push(colVals)
    }
    expect(chooseColumn(build(full, 1), 'medium')).toBe(-1)
  })
})
