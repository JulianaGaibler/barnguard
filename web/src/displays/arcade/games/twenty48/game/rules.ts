/**
 * The rules of 2048, as pure functions over an immutable {@link BoardState}. No
 * engine imports: this is the whole game, and it is testable on its own.
 *
 * The state is a list of identified tiles rather than a grid of values, because
 * the scene has to follow each tile through a move to animate it. {@link move}
 * returns a {@link MoveResult} carrying every slide and every merge, which is
 * the only thing the scene reads.
 *
 * @example
 *   let state = createEmptyState()
 *   state = spawnTile(state, stream).state
 *   const result = move(state, 'left')
 *   if (result.moved) state = spawnTile(result.state, stream).state
 */
import type { SpawnStream } from './spawn'
import {
  type BoardState,
  CELLS,
  type Direction,
  type Merge,
  type MoveResult,
  SIZE,
  type Slide,
  type Tile,
} from './types'
import { RULES } from './tuning'

/** An empty board with no score and no history. */
export function createEmptyState(): BoardState {
  return {
    tiles: [],
    score: 0,
    highest: 0,
    won: false,
    nextTileId: 1,
    spawnOrdinal: 0,
  }
}

/** The board as a grid, indexed row-major. Empty cells are `null`. */
export function occupancy(state: BoardState): (Tile | null)[] {
  const cells: (Tile | null)[] = new Array<Tile | null>(CELLS).fill(null)
  for (const t of state.tiles) cells[t.index] = t
  return cells
}

/**
 * Empty cells in ascending row-major order. This ordering is part of the spawn
 * contract: it is what a draw's `slotFrac` indexes into, so changing it changes
 * every seeded board.
 */
export function emptyIndices(state: BoardState): number[] {
  const cells = occupancy(state)
  const out: number[] = []
  for (let i = 0; i < CELLS; i++) if (!cells[i]) out.push(i)
  return out
}

/** Row of a cell index. */
export function rowOf(index: number): number {
  return Math.floor(index / SIZE)
}

/** Column of a cell index. */
export function colOf(index: number): number {
  return index % SIZE
}

/** Cell index from a column and row. */
export function indexOf(col: number, row: number): number {
  return row * SIZE + col
}

/** Unit step per direction, in grid coordinates. Row grows downward. */
const VECTORS: Record<Direction, { dc: number; dr: number }> = {
  up: { dc: 0, dr: -1 },
  down: { dc: 0, dr: 1 },
  left: { dc: -1, dr: 0 },
  right: { dc: 1, dr: 0 },
}

/**
 * Cell indices in the order a move must visit them: tiles nearest the
 * destination edge first, so each has already settled by the time the one
 * behind it is walked forward.
 */
function traversal(dir: Direction): number[] {
  const { dc, dr } = VECTORS[dir]
  const cols = [0, 1, 2, 3]
  const rows = [0, 1, 2, 3]
  if (dc === 1) cols.reverse()
  if (dr === 1) rows.reverse()
  const out: number[] = []
  for (const c of cols) for (const r of rows) out.push(indexOf(c, r))
  return out
}

/**
 * Slide every tile as far as it will go, merging equal neighbours on the way.
 * Does not spawn: the caller spawns only when `moved` is true, so a move that
 * changes nothing costs no ordinal.
 */
export function move(state: BoardState, dir: Direction): MoveResult {
  const { dc, dr } = VECTORS[dir]
  const cells = occupancy(state)
  const slides: Slide[] = []
  const merges: Merge[] = []
  // Cells holding a tile produced by THIS move. A tile may merge only once per
  // move, so these are treated as solid for the rest of the pass.
  const fused = new Set<number>()
  let nextTileId = state.nextTileId
  let gained = 0
  let moved = false

  for (const from of traversal(dir)) {
    const tile = cells[from]
    if (!tile) continue

    let col = colOf(from)
    let row = rowOf(from)
    // Walk forward while the next cell is on the board and empty.
    for (;;) {
      const nc = col + dc
      const nr = row + dr
      if (nc < 0 || nc >= SIZE || nr < 0 || nr >= SIZE) break
      if (cells[indexOf(nc, nr)]) break
      col = nc
      row = nr
    }
    const farthest = indexOf(col, row)
    const blockerIdx = indexOf(col + dc, row + dr)
    const inBounds =
      col + dc >= 0 && col + dc < SIZE && row + dr >= 0 && row + dr < SIZE
    const blocker = inBounds ? cells[blockerIdx] : null

    if (blocker && blocker.value === tile.value && !fused.has(blockerIdx)) {
      const value = tile.value * 2
      const id = nextTileId++
      cells[from] = null
      cells[blockerIdx] = { id, value, index: blockerIdx }
      fused.add(blockerIdx)
      gained += value
      moved = true
      slides.push({ id: tile.id, from, to: blockerIdx })
      merges.push({
        id,
        at: blockerIdx,
        value,
        consumed: [tile.id, blocker.id],
      })
    } else {
      cells[from] = null
      cells[farthest] = { ...tile, index: farthest }
      if (farthest !== from) {
        moved = true
        slides.push({ id: tile.id, from, to: farthest })
      }
    }
  }

  if (!moved) {
    return {
      moved: false,
      state,
      gained: 0,
      slides: [],
      merges: [],
      newHighest: null,
      reached2048: false,
    }
  }

  const tiles: Tile[] = []
  for (const c of cells) if (c) tiles.push(c)
  const highest = tiles.reduce((m, t) => (t.value > m ? t.value : m), 0)
  const won = state.won || highest >= RULES.winValue

  return {
    moved: true,
    state: {
      tiles,
      score: state.score + gained,
      highest,
      won,
      nextTileId,
      spawnOrdinal: state.spawnOrdinal,
    },
    gained,
    slides,
    merges,
    newHighest: highest > state.highest ? highest : null,
    reached2048: !state.won && won,
  }
}

/**
 * Place the next tile from `stream`. Returns the board unchanged with a `null`
 * tile when there is nowhere to put one, which only happens if a caller spawns
 * without checking `moved`.
 */
export function spawnTile(
  state: BoardState,
  stream: SpawnStream,
): { state: BoardState; tile: Tile | null } {
  const empties = emptyIndices(state)
  if (empties.length === 0) return { state, tile: null }

  const draw = stream.at(state.spawnOrdinal)
  const slot = Math.floor(draw.slotFrac * empties.length)
  const index = empties[Math.min(empties.length - 1, slot)]
  const tile: Tile = { id: state.nextTileId, value: draw.value, index }

  return {
    state: {
      tiles: [...state.tiles, tile],
      score: state.score,
      highest: Math.max(state.highest, tile.value),
      won: state.won,
      nextTileId: state.nextTileId + 1,
      spawnOrdinal: state.spawnOrdinal + 1,
    },
    tile,
  }
}

/** Deal a fresh board: an empty state plus `RULES.startTiles` tiles. */
export function createStartState(stream: SpawnStream): BoardState {
  let state = createEmptyState()
  for (let i = 0; i < RULES.startTiles; i++) {
    state = spawnTile(state, stream).state
  }
  return state
}

/**
 * Whether any move would change the board: true while a cell is empty, or while
 * two equal tiles are adjacent.
 */
export function movesAvailable(state: BoardState): boolean {
  if (state.tiles.length < CELLS) return true
  const cells = occupancy(state)
  for (let row = 0; row < SIZE; row++) {
    for (let col = 0; col < SIZE; col++) {
      const v = cells[indexOf(col, row)]?.value
      if (v === undefined) return true
      if (col + 1 < SIZE && cells[indexOf(col + 1, row)]?.value === v) {
        return true
      }
      if (row + 1 < SIZE && cells[indexOf(col, row + 1)]?.value === v) {
        return true
      }
    }
  }
  return false
}
