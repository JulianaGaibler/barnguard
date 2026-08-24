import { describe, expect, it } from 'vitest'
import { seededRandom } from '../../common/rng'
import {
  absorbGains,
  applyMove,
  fillCarvedLeft,
  createBoard,
  createMoveResult,
  cloneBoard,
  fillRandom,
  isBlocked,
  isFlooded,
  ownedCount,
  regionColor,
  seedOwners,
  separateCorners,
  unownedCount,
  type Board,
} from './board'
import { bestGain } from './generate'
import { UNOWNED } from './types'

/**
 * A board from rows of digits, so a case reads as the grid it is. Ownership is
 * seeded the way a real deal is.
 */
function boardOf(rows: string[], numColors: number, players: 1 | 2 = 1): Board {
  const cols = rows[0]!.length
  const board = createBoard(cols, rows.length, numColors)
  rows.forEach((row, r) => {
    for (let c = 0; c < cols; c++) board.color[r * cols + c] = Number(row[c])
  })
  seedOwners(board, players)
  return board
}

/** The owner grid as digit rows, for whole-board assertions. */
function ownerRows(board: Board): string[] {
  const out: string[] = []
  for (let r = 0; r < board.rows; r++) {
    let line = ''
    for (let c = 0; c < board.cols; c++) line += board.owner[r * board.cols + c]
    out.push(line)
  }
  return out
}

function colorRows(board: Board): string[] {
  const out: string[] = []
  for (let r = 0; r < board.rows; r++) {
    let line = ''
    for (let c = 0; c < board.cols; c++) line += board.color[r * board.cols + c]
    out.push(line)
  }
  return out
}

describe('starting region', () => {
  it('claims every same-colored cell connected to the corner', () => {
    const board = boardOf(['001', '010', '111'], 2)
    // The two zeroes below and right of the corner join it. The isolated zero
    // at (1,1) does not, because it only touches the corner diagonally.
    expect(ownerRows(board)).toEqual(['110', '100', '000'])
    expect(ownedCount(board, 1)).toBe(3)
  })

  it('claims the corner alone when no neighbour matches', () => {
    const board = boardOf(['011', '111', '111'], 2)
    expect(ownedCount(board, 1)).toBe(1)
  })

  it('gives each player their own corner blob in a two-player deal', () => {
    // Player 1 takes the connected zeroes, player 2 the connected ones. Every
    // cell here belongs to one blob or the other.
    const board = boardOf(['001', '011', '111'], 2, 2)
    expect(ownerRows(board)).toEqual(['112', '122', '222'])
    expect(ownedCount(board, 1)).toBe(3)
    expect(ownedCount(board, 2)).toBe(6)
  })

  it('keeps the two starting blobs disjoint', () => {
    const board = boardOf(['0120', '1201', '2012'], 3, 2)
    for (let i = 0; i < board.owner.length; i++) {
      expect(board.owner[i]).not.toBe(3)
    }
    expect(ownedCount(board, 1) + ownedCount(board, 2)).toBeLessThanOrEqual(
      board.owner.length,
    )
  })
})

describe('applyMove', () => {
  it('repaints the region and swallows matching neighbours', () => {
    const board = boardOf(['012', '112', '222'], 3)
    // The region is the single 0. Flooding to 1 pulls in the connected ones at
    // (0,1), (1,0) and (1,1), stopping at the twos.
    expect(applyMove(board, 1, 1, createMoveResult(board))).toBe(true)
    expect(colorRows(board)).toEqual(['112', '112', '222'])
    expect(ownerRows(board)).toEqual(['110', '110', '000'])
  })

  it('absorbs transitively, not just the immediate ring', () => {
    const board = boardOf(['0111', '2221', '2221'], 3)
    applyMove(board, 1, 1, createMoveResult(board))
    // Every 1 is reachable through other 1s, so the whole L comes over.
    expect(ownerRows(board)).toEqual(['1111', '0001', '0001'])
  })

  it('is a no-op when the region already shows that color', () => {
    const board = boardOf(['01', '11'], 2)
    const res = createMoveResult(board)
    const before = colorRows(board)
    expect(applyMove(board, 1, 0, res)).toBe(false)
    expect(res.count).toBe(0)
    expect(colorRows(board)).toEqual(before)
  })

  it('never takes a cell from the other player', () => {
    const board = boardOf(['001', '010', '100'], 2, 2)
    const owned2 = ownedCount(board, 2)
    for (let c = 0; c < 2; c++) applyMove(board, 1, c, createMoveResult(board))
    expect(ownedCount(board, 2)).toBe(owned2)
  })

  it('leaves the board untouched apart from the flooded region', () => {
    const board = boardOf(['012', '022', '222'], 3)
    applyMove(board, 1, 2, createMoveResult(board))
    // The lone 1 is fenced off by the region, so it stays unowned and its own
    // color even though everything around it changed.
    expect(colorRows(board)[0]![1]).toBe('1')
    expect(board.owner[1]).toBe(UNOWNED)
  })
})

describe('move depths', () => {
  it('reports breadth-first distance from the corner', () => {
    // A single row, so depth is just the column index.
    const board = boardOf(['01111'], 2)
    const res = createMoveResult(board)
    applyMove(board, 1, 1, res)
    const byCell = new Map<number, number>()
    for (let i = 0; i < res.count; i++) byCell.set(res.cells[i]!, res.depth[i]!)
    expect([...byCell.entries()].sort((a, b) => a[0] - b[0])).toEqual([
      [0, 0],
      [1, 1],
      [2, 2],
      [3, 3],
      [4, 4],
    ])
    expect(res.maxDepth).toBe(4)
  })

  it('never reports a depth out of order', () => {
    const rng = seededRandom(99)
    const board = createBoard(12, 12, 4)
    fillRandom(board, rng)
    seedOwners(board, 1)
    const res = createMoveResult(board)
    for (let move = 0; move < 20; move++) {
      applyMove(board, 1, move % 4, res)
      for (let i = 1; i < res.count; i++) {
        expect(res.depth[i]!).toBeGreaterThanOrEqual(res.depth[i - 1]!)
      }
    }
  })

  it('marks captured cells apart from repainted ones', () => {
    const board = boardOf(['011', '222'], 3)
    const res = createMoveResult(board)
    applyMove(board, 1, 1, res)
    // The corner was already held and only changed color, so the two 1s are
    // the new ones.
    expect(res.absorbed).toBe(2)
    expect(res.count).toBe(3)
    expect(res.captured[0]).toBe(0)
  })
})

describe('counts and end conditions', () => {
  it('flags a flooded board', () => {
    const board = boardOf(['01', '11'], 2)
    expect(isFlooded(board, 1)).toBe(false)
    applyMove(board, 1, 1, createMoveResult(board))
    expect(isFlooded(board, 1)).toBe(true)
    expect(unownedCount(board)).toBe(0)
  })

  it('flags a player with no unowned cell left to reach', () => {
    // Player 1 in the corner, fenced in on both sides by player 2's blob.
    const board = createBoard(3, 3, 2)
    board.color.set([0, 1, 1, 1, 1, 1, 1, 1, 1])
    board.owner.set([1, 2, 2, 2, 0, 0, 0, 0, 0])
    expect(isBlocked(board, 1)).toBe(true)
    expect(isBlocked(board, 2)).toBe(false)
  })

  it('does not flag a player who still touches open ground', () => {
    const board = boardOf(['011', '111'], 2)
    expect(isBlocked(board, 1)).toBe(false)
  })
})

describe('separateCorners', () => {
  it('repaints the far corner only when it matches the near one', () => {
    const board = createBoard(3, 1, 4)
    board.color.set([2, 0, 2])
    separateCorners(board, seededRandom(1))
    expect(board.color[2]).not.toBe(2)
    expect(board.color[0]).toBe(2)
    expect(board.color[1]).toBe(0)
  })

  it('leaves a board whose corners already differ alone', () => {
    const board = createBoard(3, 1, 4)
    board.color.set([2, 0, 3])
    separateCorners(board, seededRandom(1))
    expect([...board.color]).toEqual([2, 0, 3])
  })

  it('always produces a color in range', () => {
    for (let seed = 0; seed < 50; seed++) {
      const board = createBoard(4, 1, 3)
      board.color.set([1, 0, 0, 1])
      separateCorners(board, seededRandom(seed))
      expect(board.color[3]).toBeGreaterThanOrEqual(0)
      expect(board.color[3]).toBeLessThan(3)
      expect(board.color[3]).not.toBe(1)
    }
  })
})

describe('random play', () => {
  it('always terminates in a flood, and only ever grows the region', () => {
    for (let seed = 0; seed < 40; seed++) {
      const rng = seededRandom(seed)
      const board = createBoard(9, 9, 4)
      fillRandom(board, rng)
      seedOwners(board, 1)
      const res = createMoveResult(board)
      let owned = ownedCount(board, 1)
      let guard = 0
      while (!isFlooded(board, 1) && guard++ < 500) {
        const current = regionColor(board, 1)
        const pick = (current + 1 + Math.floor(rng() * 3)) % 4
        applyMove(board, 1, pick, res)
        const now = ownedCount(board, 1)
        expect(now).toBeGreaterThanOrEqual(owned)
        owned = now
      }
      expect(isFlooded(board, 1)).toBe(true)
    }
  })

  it('leaves a clone independent of its source', () => {
    const board = boardOf(['011', '111'], 2)
    const copy = cloneBoard(board)
    applyMove(copy, 1, 1, createMoveResult(copy))
    expect(isFlooded(copy, 1)).toBe(true)
    expect(isFlooded(board, 1)).toBe(false)
  })
})

describe('carving the left edge', () => {
  /** Cut depth per row: how many cells from the left are the carve color. */
  function cutDepths(board: ReturnType<typeof createBoard>): number[] {
    const out: number[] = []
    for (let row = 0; row < board.rows; row++) {
      let depth = 0
      while (
        depth < board.cols &&
        board.color[row * board.cols + depth] === 0
      ) {
        depth++
      }
      out.push(depth)
    }
    return out
  }

  it('leaves the top row whole and eats deepest at the bottom', () => {
    for (let seed = 0; seed < 20; seed++) {
      const board = createBoard(12, 12, 5)
      fillCarvedLeft(board, seededRandom(seed), 0.62)
      const depths = cutDepths(board)
      // The top row is where a region grows from, so it always keeps its width.
      expect(depths[0], `seed ${seed}`).toBe(0)
      expect(depths[11]!, `seed ${seed}`).toBeGreaterThan(depths[0]!)
    }
  })

  it('trends deeper down the board', () => {
    // Row to row it wanders, so the trend is checked over thirds rather than
    // between neighbours.
    const rows = 12
    const totals = [0, 0, 0]
    for (let seed = 0; seed < 40; seed++) {
      const board = createBoard(12, rows, 5)
      fillCarvedLeft(board, seededRandom(seed), 0.62)
      const depths = cutDepths(board)
      for (let row = 0; row < rows; row++) {
        totals[Math.floor((row / rows) * 3)]! += depths[row]!
      }
    }
    expect(totals[1]!).toBeGreaterThan(totals[0]!)
    expect(totals[2]!).toBeGreaterThan(totals[1]!)
  })

  it('wanders, so the boundary is ragged rather than a clean diagonal', () => {
    const board = createBoard(14, 14, 5)
    fillCarvedLeft(board, seededRandom(5), 0.62)
    const depths = cutDepths(board)
    // A clean diagonal would step by the same amount every row.
    const steps = new Set<number>()
    for (let i = 1; i < depths.length; i++)
      steps.add(depths[i]! - depths[i - 1]!)
    expect(steps.size).toBeGreaterThan(2)
  })

  it('never cuts past the board', () => {
    for (const frac of [0.2, 0.62, 1, 1.5]) {
      const board = createBoard(10, 10, 4)
      fillCarvedLeft(board, seededRandom(2), frac)
      for (const depth of cutDepths(board)) {
        expect(depth, `frac ${frac}`).toBeGreaterThanOrEqual(0)
        expect(depth, `frac ${frac}`).toBeLessThanOrEqual(10)
      }
    }
  })

  it('keeps the carve color out of the body of the board', () => {
    // Anything but the cut has to be a shade, or a stray hole in the middle
    // would block a flood that can never fill it.
    for (let seed = 0; seed < 20; seed++) {
      const board = createBoard(12, 12, 5)
      fillCarvedLeft(board, seededRandom(seed), 0.62)
      const depths = cutDepths(board)
      for (let row = 0; row < 12; row++) {
        for (let col = depths[row]!; col < 12; col++) {
          expect(board.color[row * 12 + col], `${row},${col}`).toBeGreaterThan(
            0,
          )
        }
      }
    }
  })

  it('holds the cut through a run that never floods to its color', () => {
    const board = createBoard(12, 12, 5)
    fillCarvedLeft(board, seededRandom(9), 0.62)
    seedOwners(board, 1)
    const carved = [...board.color]
      .map((c, i) => (c === 0 ? i : -1))
      .filter((i) => i >= 0)
    expect(carved.length).toBeGreaterThan(15)

    const res = createMoveResult(board)
    for (let move = 0; move < 60; move++) {
      applyMove(board, 1, 1 + (move % 4), res)
    }
    for (const i of carved) {
      expect(board.color[i], `cut ${i}`).toBe(0)
      expect(board.owner[i], `cut ${i}`).toBe(UNOWNED)
    }
  })

  it('never walls a region in while there is still ground to take', () => {
    // The reason the top rows are spared. Greedy running out of moves has to
    // mean the board is exhausted, never that the cut fenced the region off.
    for (let seed = 0; seed < 12; seed++) {
      const board = createBoard(16, 16, 7)
      fillCarvedLeft(board, seededRandom(seed), 0.62)
      seedOwners(board, 1)
      const reachable = [...board.color].filter((c) => c !== 0).length
      const scratch = createBoard(16, 16, 7)
      const res = createMoveResult(board)
      const gains = new Int32Array(7)

      for (let move = 0; move < 14; move++) {
        absorbGains(board, 1, scratch, res, gains)
        gains[0] = 0
        const pick = bestGain(gains)
        if (pick < 0) {
          expect(ownedCount(board, 1), `seed ${seed} stuck early`).toBe(
            reachable,
          )
          break
        }
        applyMove(board, 1, pick, res)
      }
    }
  })

  it('leaves most of the field untouched over a short run', () => {
    // A backdrop is texture. A run that floods the whole board replaces the
    // pattern with one flat shade.
    const board = createBoard(16, 16, 7)
    fillCarvedLeft(board, seededRandom(4), 0.62)
    seedOwners(board, 1)
    const reachable = [...board.color].filter((c) => c !== 0).length
    const scratch = createBoard(16, 16, 7)
    const res = createMoveResult(board)
    const gains = new Int32Array(7)

    for (let move = 0; move < 9; move++) {
      absorbGains(board, 1, scratch, res, gains)
      gains[0] = 0
      applyMove(board, 1, bestGain(gains), res)
    }
    expect(ownedCount(board, 1)).toBeLessThan(reachable * 0.4)
  })
})
