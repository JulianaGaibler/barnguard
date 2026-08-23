import { describe, expect, it } from 'vitest'
import {
  colOf,
  createEmptyState,
  createStartState,
  emptyIndices,
  indexOf,
  move,
  movesAvailable,
  occupancy,
  rowOf,
  spawnTile,
} from './rules'
import { createSpawnStream } from './spawn'
import { RULES } from './tuning'
import { type BoardState, type Direction, SIZE, type Tile } from './types'

/**
 * Build a state from a grid of values written the way it looks on screen, with
 * `0` for an empty cell. Ids are assigned in reading order.
 */
function board(
  rows: number[][],
  overrides: Partial<BoardState> = {},
): BoardState {
  const tiles: Tile[] = []
  let id = 1
  rows.forEach((cells, row) => {
    cells.forEach((value, col) => {
      if (value) tiles.push({ id: id++, value, index: indexOf(col, row) })
    })
  })
  const highest = tiles.reduce((m, t) => Math.max(m, t.value), 0)
  return {
    tiles,
    score: 0,
    highest,
    won: false,
    nextTileId: id,
    spawnOrdinal: 0,
    ...overrides,
  }
}

/** Read a state back as a grid of values, for comparison against a literal. */
function grid(state: BoardState): number[][] {
  const cells = occupancy(state)
  const out: number[][] = []
  for (let row = 0; row < SIZE; row++) {
    out.push(
      cells.slice(row * SIZE, row * SIZE + SIZE).map((t) => t?.value ?? 0),
    )
  }
  return out
}

describe('cell indexing', () => {
  it('round-trips column and row', () => {
    for (let i = 0; i < SIZE * SIZE; i++) {
      expect(indexOf(colOf(i), rowOf(i))).toBe(i)
    }
  })
})

describe('move', () => {
  it('compacts toward each edge', () => {
    const rows = [
      [2, 0, 0, 4],
      [0, 0, 0, 0],
      [0, 8, 0, 0],
      [0, 0, 0, 0],
    ]
    expect(grid(move(board(rows), 'left').state)).toEqual([
      [2, 4, 0, 0],
      [0, 0, 0, 0],
      [8, 0, 0, 0],
      [0, 0, 0, 0],
    ])
    expect(grid(move(board(rows), 'right').state)).toEqual([
      [0, 0, 2, 4],
      [0, 0, 0, 0],
      [0, 0, 0, 8],
      [0, 0, 0, 0],
    ])
    expect(grid(move(board(rows), 'up').state)).toEqual([
      [2, 8, 0, 4],
      [0, 0, 0, 0],
      [0, 0, 0, 0],
      [0, 0, 0, 0],
    ])
    expect(grid(move(board(rows), 'down').state)).toEqual([
      [0, 0, 0, 0],
      [0, 0, 0, 0],
      [0, 0, 0, 0],
      [2, 8, 0, 4],
    ])
  })

  it('merges a tile at most once per move', () => {
    const result = move(
      board([
        [4, 4, 4, 4],
        [0, 0, 0, 0],
        [0, 0, 0, 0],
        [0, 0, 0, 0],
      ]),
      'left',
    )
    expect(grid(result.state)[0]).toEqual([8, 8, 0, 0])
    expect(result.merges).toHaveLength(2)
    expect(result.gained).toBe(16)
  })

  it('resolves merges from the direction of travel', () => {
    // Moving left, the leftmost pair merges and the third tile follows.
    const result = move(
      board([
        [2, 2, 4, 0],
        [0, 0, 0, 0],
        [0, 0, 0, 0],
        [0, 0, 0, 0],
      ]),
      'left',
    )
    expect(grid(result.state)[0]).toEqual([4, 4, 0, 0])
    // Moving right with three equal tiles, the pair nearest the right edge wins.
    const right = move(
      board([
        [2, 2, 2, 0],
        [0, 0, 0, 0],
        [0, 0, 0, 0],
        [0, 0, 0, 0],
      ]),
      'right',
    )
    expect(grid(right.state)[0]).toEqual([0, 0, 2, 4])
  })

  it('adds the merged value to the score', () => {
    const result = move(
      board([
        [8, 8, 0, 0],
        [4, 4, 0, 0],
        [0, 0, 0, 0],
        [0, 0, 0, 0],
      ]),
      'left',
    )
    expect(result.gained).toBe(24)
    expect(result.state.score).toBe(24)
  })

  it('reports no move and keeps the same state when nothing shifts', () => {
    const before = board([
      [2, 4, 2, 4],
      [4, 2, 4, 2],
      [2, 4, 2, 4],
      [4, 2, 4, 2],
    ])
    const result = move(before, 'left')
    expect(result.moved).toBe(false)
    expect(result.state).toBe(before)
    expect(result.state.spawnOrdinal).toBe(before.spawnOrdinal)
  })

  it('records a slide for every tile that changed cell', () => {
    const before = board([
      [2, 0, 0, 2],
      [0, 0, 0, 0],
      [0, 0, 0, 0],
      [0, 0, 0, 0],
    ])
    const result = move(before, 'left')
    // The left tile is already home, so only the right one slides in, and it
    // slides onto the cell it merges into.
    expect(result.slides).toEqual([{ id: 2, from: 3, to: 0 }])
    expect(result.merges).toHaveLength(1)
    expect(result.merges[0].at).toBe(0)
    expect(result.merges[0].consumed).toEqual([2, 1])
  })

  it('gives the merged tile a fresh id', () => {
    const before = board([
      [2, 2, 0, 0],
      [0, 0, 0, 0],
      [0, 0, 0, 0],
      [0, 0, 0, 0],
    ])
    const result = move(before, 'left')
    const merged = result.merges[0]
    expect(merged.id).toBe(before.nextTileId)
    expect(merged.consumed).not.toContain(merged.id)
    expect(result.state.nextTileId).toBeGreaterThan(before.nextTileId)
  })

  it('reports a new highest only when one is reached', () => {
    const before = board([
      [2, 2, 8, 0],
      [0, 0, 0, 0],
      [0, 0, 0, 0],
      [0, 0, 0, 0],
    ])
    expect(move(before, 'left').newHighest).toBeNull()
    const bigger = board([
      [8, 8, 0, 0],
      [0, 0, 0, 0],
      [0, 0, 0, 0],
      [0, 0, 0, 0],
    ])
    expect(move(bigger, 'left').newHighest).toBe(16)
  })

  it('flags reaching 2048 exactly once', () => {
    const before = board([
      [1024, 1024, 0, 0],
      [0, 0, 0, 0],
      [0, 0, 0, 0],
      [0, 0, 0, 0],
    ])
    const first = move(before, 'left')
    expect(first.reached2048).toBe(true)
    expect(first.state.won).toBe(true)
    const after = move(
      {
        ...first.state,
        tiles: [...first.state.tiles, { id: 99, value: 2048, index: 1 }],
      },
      'left',
    )
    expect(after.reached2048).toBe(false)
    expect(after.state.won).toBe(true)
  })
})

describe('movesAvailable', () => {
  it('is true while a cell is empty', () => {
    expect(movesAvailable(createEmptyState())).toBe(true)
  })

  it('is true on a full board with an adjacent equal pair', () => {
    const full = board([
      [2, 4, 2, 4],
      [4, 2, 4, 2],
      [2, 4, 2, 4],
      [4, 2, 4, 4],
    ])
    expect(movesAvailable(full)).toBe(true)
  })

  it('is false on a full board with no equal neighbours', () => {
    const dead = board([
      [2, 4, 2, 4],
      [4, 2, 4, 2],
      [2, 4, 2, 4],
      [4, 2, 4, 2],
    ])
    expect(movesAvailable(dead)).toBe(false)
  })
})

describe('spawnTile', () => {
  it('deals the opening tiles and advances the ordinal', () => {
    const state = createStartState(createSpawnStream(7))
    expect(state.tiles).toHaveLength(2)
    expect(state.spawnOrdinal).toBe(2)
    for (const t of state.tiles) expect([2, 4]).toContain(t.value)
  })

  it('only ever lands on an empty cell', () => {
    const stream = createSpawnStream(11)
    let state = createStartState(stream)
    while (emptyIndices(state).length > 0) {
      const before = emptyIndices(state)
      const { state: next, tile } = spawnTile(state, stream)
      expect(tile).not.toBeNull()
      expect(before).toContain(tile?.index)
      state = next
    }
    expect(state.tiles).toHaveLength(SIZE * SIZE)
  })

  it('returns the board unchanged when there is no room', () => {
    const full = board([
      [2, 4, 2, 4],
      [4, 2, 4, 2],
      [2, 4, 2, 4],
      [4, 2, 4, 2],
    ])
    const { state, tile } = spawnTile(full, createSpawnStream(1))
    expect(tile).toBeNull()
    expect(state).toBe(full)
  })
})

describe('a whole run', () => {
  it('plays to a stuck board and stops', () => {
    // The pure layers driven exactly as the session drives them, so the loop
    // itself is covered rather than only its pieces.
    const stream = createSpawnStream(2048)
    let state = createStartState(stream)
    const dirs: Direction[] = ['left', 'up', 'right', 'down']
    let moves = 0
    let expectedScore = 0

    while (movesAvailable(state) && moves < 5000) {
      let played = false
      for (let i = 0; i < dirs.length; i++) {
        const result = move(state, dirs[(moves + i) % dirs.length])
        if (!result.moved) continue
        expectedScore += result.gained
        state = spawnTile(result.state, stream).state
        played = true
        break
      }
      if (!played) break
      moves++
    }

    expect(moves).toBeGreaterThan(20)
    expect(movesAvailable(state)).toBe(false)
    expect(state.tiles).toHaveLength(SIZE * SIZE)
    expect(state.score).toBe(expectedScore)
    // Every merge pays the tile it produced, so the score is a sum of powers
    // of two and can never be odd.
    expect(state.score % 2).toBe(0)
  })

  it('spends exactly one spawn ordinal per move that changed the board', () => {
    const stream = createSpawnStream(19)
    let state = createStartState(stream)
    let spawns = RULES.startTiles
    for (let i = 0; i < 200 && movesAvailable(state); i++) {
      const dir: Direction = (['left', 'up', 'right', 'down'] as const)[i % 4]
      const result = move(state, dir)
      if (!result.moved) continue
      state = spawnTile(result.state, stream).state
      spawns++
    }
    expect(state.spawnOrdinal).toBe(spawns)
  })
})

describe('newHighest', () => {
  it('reports every new biggest tile, not just the first past the goal', () => {
    // Drives the milestone ring below the goal. `reached2048` is a one-shot
    // rules flag for `won` and deliberately not what any celebration reads.
    const rows = (a: number, b: number) =>
      board([
        [a, b, 0, 0],
        [0, 0, 0, 0],
        [0, 0, 0, 0],
        [0, 0, 0, 0],
      ])
    expect(move(rows(1024, 1024), 'left').newHighest).toBe(2048)
    expect(move(rows(2048, 2048), 'left').newHighest).toBe(4096)
    expect(move(rows(4096, 4096), 'left').newHighest).toBe(8192)
  })

  it('stays null when a merge does not beat the current biggest', () => {
    const state = board([
      [2, 2, 0, 0],
      [0, 0, 0, 0],
      [0, 0, 0, 1024],
      [0, 0, 0, 0],
    ])
    expect(move(state, 'left').newHighest).toBeNull()
  })

  it('flags reaching the goal once but keeps reporting bigger tiles', () => {
    const first = move(
      board([
        [1024, 1024, 0, 0],
        [0, 0, 0, 0],
        [0, 0, 0, 0],
        [0, 0, 0, 0],
      ]),
      'left',
    )
    expect(first.reached2048).toBe(true)
    const next = move(
      {
        ...first.state,
        tiles: [
          { id: 1, value: 2048, index: 0 },
          { id: 2, value: 2048, index: 1 },
        ],
      },
      'left',
    )
    expect(next.reached2048).toBe(false)
    expect(next.newHighest).toBe(4096)
  })
})

describe('goal-level merges', () => {
  // Written relative to `RULES.winValue` rather than to 2048, so these hold
  // whichever value the goal is set to.
  const GOAL = RULES.winValue
  const HALF = GOAL / 2
  const QUARTER = GOAL / 4

  /** What the goal celebration reads: any merge landing on the win value. */
  function goalMerges(state: BoardState, dir: Direction): number[] {
    return move(state, dir)
      .merges.filter((m) => m.value >= GOAL)
      .map((m) => m.value)
  }

  it('reports a goal merge even when it sets no new record', () => {
    // A second goal tile on a board that already has one. The run set its
    // record long ago, and this must still celebrate.
    const state = board(
      [
        [HALF, HALF, 0, GOAL],
        [0, 0, 0, 0],
        [0, 0, 0, 0],
        [0, 0, 0, 0],
      ],
      { won: true },
    )
    const result = move(state, 'left')
    expect(result.newHighest).toBeNull()
    expect(result.reached2048).toBe(false)
    expect(goalMerges(state, 'left')).toEqual([GOAL])
  })

  it('reports every goal merge in a move that makes two', () => {
    const state = board(
      [
        [HALF, HALF, 0, 0],
        [HALF, HALF, 0, 0],
        [0, 0, 0, 0],
        [0, 0, 0, 0],
      ],
      { won: true },
    )
    expect(goalMerges(state, 'left')).toEqual([GOAL, GOAL])
  })

  it('reports nothing for merges below the goal', () => {
    const state = board([
      [QUARTER, QUARTER, 0, 0],
      [0, 0, 0, 0],
      [0, 0, 0, 0],
      [0, 0, 0, 0],
    ])
    expect(goalMerges(state, 'left')).toEqual([])
  })
})
