import { describe, expect, it } from 'vitest'
import {
  FULL_DEMO_ROWS,
  GOAL_DEMO_MOVES,
  GOAL_DEMO_ROWS,
  MERGE_DEMO_MOVES,
  MERGE_DEMO_ROWS,
  MOVE_DEMO_MOVES,
  MOVE_DEMO_ROWS,
} from './demo'
import { emptyIndices, indexOf, move, movesAvailable } from './rules'
import { type BoardState, type Direction, SIZE, type Tile } from './types'

function stateFrom(rows: readonly (readonly number[])[]): BoardState {
  const tiles: Tile[] = []
  let id = 1
  rows.forEach((cells, row) => {
    cells.forEach((value, col) => {
      if (value) tiles.push({ id: id++, value, index: indexOf(col, row) })
    })
  })
  return {
    tiles,
    score: 0,
    highest: tiles.reduce((m, t) => Math.max(m, t.value), 0),
    won: false,
    nextTileId: id,
    spawnOrdinal: 0,
  }
}

describe('the "fills up and it ends" tutorial board', () => {
  const state = stateFrom(FULL_DEMO_ROWS)

  it('has exactly one free cell', () => {
    expect(emptyIndices(state)).toHaveLength(1)
    expect(state.tiles).toHaveLength(SIZE * SIZE - 1)
  })

  it('still has a legal move before the last tile lands', () => {
    expect(movesAvailable(state)).toBe(true)
  })

  it('is dead whichever value lands in the last cell', () => {
    // The card claims the run is over. It would be demonstrating the opposite
    // if a 2 (the 90% case) left a merge available, which is what the first
    // version of this board did.
    const free = emptyIndices(state)[0]
    for (const value of [2, 4]) {
      const filled: BoardState = {
        ...state,
        tiles: [...state.tiles, { id: 99, value, index: free }],
      }
      expect(movesAvailable(filled), `spawned a ${value}`).toBe(false)
    }
  })
})

describe('every scripted tutorial move', () => {
  const CARDS: Array<
    [string, readonly (readonly number[])[], readonly Direction[]]
  > = [
    ['swipe or tap', MOVE_DEMO_ROWS, MOVE_DEMO_MOVES],
    ['equal tiles merge', MERGE_DEMO_ROWS, MERGE_DEMO_MOVES],
    ['reach 2048', GOAL_DEMO_ROWS, GOAL_DEMO_MOVES],
  ]

  it.each(CARDS)(
    'changes the board on every move of "%s"',
    (_name, rows, dirs) => {
      // A scripted move that is secretly a no-op leaves the card playing a
      // gesture with nothing happening after it. Two of these shipped that way:
      // the board was already packed against the edge the demo then swiped
      // toward.
      let state = stateFrom(rows)
      dirs.forEach((dir, i) => {
        const result = move(state, dir)
        expect(result.moved, `move ${i + 1} (${dir})`).toBe(true)
        state = result.state
      })
    },
  )

  it('merges something on the card that is about merging', () => {
    let state = stateFrom(MERGE_DEMO_ROWS)
    let gained = 0
    for (const dir of MERGE_DEMO_MOVES) {
      const result = move(state, dir)
      gained += result.gained
      state = result.state
    }
    expect(gained).toBeGreaterThan(0)
  })
})
