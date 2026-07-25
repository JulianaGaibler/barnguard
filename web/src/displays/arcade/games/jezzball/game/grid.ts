/**
 * The logical JezzBall grid: the source of truth for capture percentage,
 * level-clear, and collider geometry. Pure and allocation-light so it is
 * unit-testable in isolation and independent of the renderer/physics timing.
 *
 * Cells are a flat `Uint8Array` of {@link CellState}; index is `row * cols +
 * col`, row 0 at the top, y grows downward (matching world coordinates).
 */
import {
  CELL_FILLED,
  CELL_OPEN,
  CELL_WALL,
  type CellRef,
  type CellState,
  type Orientation,
} from './types'

export interface Grid {
  readonly cols: number
  readonly rows: number
  /** `row * cols + col` → {@link CellState}. */
  readonly cells: Uint8Array
}

export function createGrid(cols: number, rows: number): Grid {
  return { cols, rows, cells: new Uint8Array(cols * rows) }
}

export function cloneGrid(g: Grid): Grid {
  return { cols: g.cols, rows: g.rows, cells: g.cells.slice() }
}

export function inBounds(g: Grid, col: number, row: number): boolean {
  return col >= 0 && col < g.cols && row >= 0 && row < g.rows
}

export function cellAt(g: Grid, col: number, row: number): CellState {
  return g.cells[row * g.cols + col] as CellState
}

export function setCell(
  g: Grid,
  col: number,
  row: number,
  state: CellState,
): void {
  g.cells[row * g.cols + col] = state
}

/** Mark a cell as a solid wall (no-op if out of bounds). */
export function markWall(g: Grid, col: number, row: number): void {
  if (inBounds(g, col, row)) g.cells[row * g.cols + col] = CELL_WALL
}

/**
 * Mark a whole wall span (as returned by {@link wallSpans}) solid, one
 * axis-aligned run of cells at `fixedIndex` from `startCell` to `endCell`
 * inclusive. Shared by the board's segment solidify step and the tutorial
 * demos so both write the grid the same way.
 */
export function markWallSpan(
  g: Grid,
  orientation: Orientation,
  fixedIndex: number,
  startCell: number,
  endCell: number,
): void {
  for (let i = startCell; i <= endCell; i++) {
    if (orientation === 'vertical') g.cells[i * g.cols + fixedIndex] = CELL_WALL
    else g.cells[fixedIndex * g.cols + i] = CELL_WALL
  }
}

/** Count of flood-filled (captured-region) cells; excludes the player's walls. */
export function filledCount(g: Grid): number {
  let n = 0
  const cells = g.cells
  for (let i = 0; i < cells.length; i++) if (cells[i] === CELL_FILLED) n++
  return n
}

/**
 * Taken surface as a percentage of the whole arena (0..100): the captured
 * regions ({@link filledCount}) plus the player's walls. A wall is solid surface
 * the player claimed, so it counts alongside the region it seals.
 */
export function takenPct(g: Grid): number {
  const cells = g.cells
  let walls = 0
  for (let i = 0; i < cells.length; i++) if (cells[i] === CELL_WALL) walls++
  return ((filledCount(g) + walls) / (g.cols * g.rows)) * 100
}

/** The two whole-cell spans of a two-way wall placed at `seed`. */
export interface WallSpans {
  /** Inclusive `[start, end]` cells for segment A (owns the seed cell). */
  a: [number, number]
  /** Inclusive `[start, end]` for segment B (one past the seed), or null. */
  b: [number, number] | null
}

/**
 * Compute the cell spans a two-way wall from `seed` would occupy, extending
 * through open cells until blocked. Segment A owns the seed cell and every open
 * cell before it; segment B starts one cell past the seed. Splitting on the
 * seed cell's boundary (rather than its center) means every solidified cell is
 * owned by exactly one segment — so if one half is destroyed the seed cell
 * stays open and a follow-up wall abuts the survivor cleanly, with no orphaned
 * half-cell.
 */
export function wallSpans(
  g: Grid,
  orientation: Orientation,
  seed: CellRef,
): WallSpans {
  const horizontal = orientation === 'horizontal'
  const fixedIndex = horizontal ? seed.row : seed.col
  const seedIndex = horizontal ? seed.col : seed.row
  const maxIndex = (horizontal ? g.cols : g.rows) - 1
  const openAt = (idx: number): boolean =>
    (horizontal ? cellAt(g, idx, fixedIndex) : cellAt(g, fixedIndex, idx)) ===
    CELL_OPEN

  let a0 = seedIndex
  while (a0 - 1 >= 0 && openAt(a0 - 1)) a0--
  let b1 = seedIndex
  while (b1 + 1 <= maxIndex && openAt(b1 + 1)) b1++

  return {
    a: [a0, seedIndex],
    b: b1 >= seedIndex + 1 ? [seedIndex + 1, b1] : null,
  }
}

/**
 * Capture every open region that contains no ball. Call right after a wall
 * solidifies (its cells already set to {@link CELL_WALL}). `ballCells` are the
 * grid cells the live balls occupy (typically each ball's center cell).
 *
 * Walks connected components of {@link CELL_OPEN} cells (4-connectivity, walls
 * and filled cells are barriers); any component free of a ball is converted to
 * {@link CELL_FILLED}. Returns the cells newly filled, in scan order, so the
 * caller can animate the flood. Deterministic: cells are scanned in index order
 * and the BFS uses a stable queue.
 *
 * Scanning the whole grid rather than only the new wall's neighbors is
 * equivalent in result — any ball-free enclosed region was already filled when
 * it formed, so only regions the new wall just sealed can newly qualify — and
 * avoids seed bookkeeping.
 */
export function captureEmptyRegions(g: Grid, ballCells: CellRef[]): CellRef[] {
  const { cols, rows, cells } = g
  const n = cells.length
  const visited = new Uint8Array(n)

  const ballIndices = new Set<number>()
  for (const b of ballCells) {
    if (inBounds(g, b.col, b.row)) ballIndices.add(b.row * cols + b.col)
  }

  const filled: CellRef[] = []
  const queue = new Int32Array(n)
  const region = new Int32Array(n)

  for (let start = 0; start < n; start++) {
    if (cells[start] !== CELL_OPEN || visited[start]) continue

    // BFS this open region, recording its cells and whether a ball sits in it.
    let head = 0
    let tail = 0
    let regionLen = 0
    let hasBall = false
    visited[start] = 1
    queue[tail++] = start
    while (head < tail) {
      const idx = queue[head++]
      region[regionLen++] = idx
      if (ballIndices.has(idx)) hasBall = true
      const col = idx % cols
      const row = (idx - col) / cols
      // Enqueue any open, unvisited 4-neighbor.
      if (col > 0 && cells[idx - 1] === CELL_OPEN && !visited[idx - 1]) {
        visited[idx - 1] = 1
        queue[tail++] = idx - 1
      }
      if (col < cols - 1 && cells[idx + 1] === CELL_OPEN && !visited[idx + 1]) {
        visited[idx + 1] = 1
        queue[tail++] = idx + 1
      }
      if (row > 0 && cells[idx - cols] === CELL_OPEN && !visited[idx - cols]) {
        visited[idx - cols] = 1
        queue[tail++] = idx - cols
      }
      if (
        row < rows - 1 &&
        cells[idx + cols] === CELL_OPEN &&
        !visited[idx + cols]
      ) {
        visited[idx + cols] = 1
        queue[tail++] = idx + cols
      }
    }

    if (!hasBall) {
      for (let k = 0; k < regionLen; k++) {
        const idx = region[k]
        cells[idx] = CELL_FILLED
        const col = idx % cols
        filled.push({ col, row: (idx - col) / cols })
      }
    }
  }

  return filled
}
