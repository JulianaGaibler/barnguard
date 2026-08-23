/**
 * The board and the one rule that matters: flooding a region.
 *
 * A board is two flat row-major byte arrays, a color index and an owner, so the
 * whole state is two allocations and a drawing node can read it directly each
 * frame. Pure and engine-free, so every rule here is testable on its own.
 *
 * A move repaints the mover's whole region to the chosen color, then swallows
 * every unowned cell that now touches it and matches, transitively. That is the
 * same thing as the usual "the region is the connected blob sharing the corner
 * cell's color" phrasing, because a repainted blob's matching neighbours are by
 * definition part of the blob. Tracking ownership explicitly instead of
 * rediscovering the blob each time is what lets one routine serve the solo
 * puzzle, the race and the two-player territory contest, and it makes the owned
 * count, the region boundary and the win check reads rather than searches.
 */
import { UNOWNED, type Color, type PlayerId } from './types'

/** A board's cells. `color` and `owner` are parallel and row-major. */
export interface Board {
  readonly cols: number
  readonly rows: number
  readonly numColors: number
  /** Color index per cell. */
  readonly color: Uint8Array
  /** {@link UNOWNED}, or the {@link PlayerId} holding the cell. */
  readonly owner: Uint8Array
}

/**
 * What one move touched, in breadth-first order out from the mover's corner.
 *
 * The arrays are sized for a whole board and reused across moves, so a move
 * allocates nothing. Only the first `count` entries are meaningful, and all
 * three are parallel: `cells[i]` was reached at `depth[i]`, and `captured[i]`
 * says whether it was taken from nobody or was already held.
 *
 * The depths are what the flood animation staggers on, which is why the fill is
 * breadth-first rather than the cheaper depth-first.
 */
export interface MoveResult {
  readonly cells: Int32Array
  readonly depth: Int32Array
  /** 1 for a cell newly taken, 0 for one the mover already held. */
  readonly captured: Uint8Array
  /** Meaningful entries in the three arrays above. */
  count: number
  /** How many of those entries were newly taken. */
  absorbed: number
  /** Largest depth reached, so a caller can scale the stagger to the wave. */
  maxDepth: number
}

/** Column offsets of the four orthogonal neighbours. */
const DX = [1, -1, 0, 0] as const
/** Row offsets, paired with {@link DX}. */
const DY = [0, 0, 1, -1] as const

/** An empty board with every cell unowned. Colors are left at 0. */
export function createBoard(
  cols: number,
  rows: number,
  numColors: number,
): Board {
  return {
    cols,
    rows,
    numColors,
    color: new Uint8Array(cols * rows),
    owner: new Uint8Array(cols * rows),
  }
}

/** Fill every cell with a random color. Ownership is untouched. */
export function fillRandom(board: Board, random: () => number): void {
  const { color, numColors } = board
  for (let i = 0; i < color.length; i++) {
    color[i] = Math.floor(random() * numColors)
  }
}

/** Color reserved for cells cut away from the board. */
const CARVED = 0

/** How far a row's cut wanders from the trend, in cells, at the bottom. */
const CARVE_JITTER = 2

/**
 * Fill the board, cutting a ragged bite out of its left side that grows deeper
 * toward the bottom.
 *
 * Each row loses a number of cells from the left: none at the top row, up to
 * `depthFrac` of the width at the bottom, with the depth wandering row to row
 * so the boundary is jagged rather than a clean diagonal. Cut cells take
 * {@link CARVED}, and the rest of the board is dealt from the colors above it.
 *
 * For a decorative board that has to dissolve on the side facing a menu instead
 * of ending on a straight line. Two properties fall out of the shape: the top
 * rows keep their full width, so a region growing from that corner always has
 * somewhere to go, and reserving one color for the cut means a caller that
 * never floods to it keeps the bite intact for the whole run without any cell
 * in the body of the board being able to block a flood.
 */
export function fillCarvedLeft(
  board: Board,
  random: () => number,
  depthFrac: number,
): void {
  const { cols, rows, color, numColors } = board
  const shades = Math.max(1, numColors - 1)
  for (let row = 0; row < rows; row++) {
    // Zero at the top row, and the wander scales with it, so the cut opens out
    // of the corner rather than starting at a jagged step.
    const t = rows > 1 ? row / (rows - 1) : 0
    const wander = (random() * 2 - 1) * CARVE_JITTER * t
    const cut = clampInt(Math.round(t * cols * depthFrac + wander), 0, cols)
    for (let col = 0; col < cols; col++) {
      color[row * cols + col] =
        col < cut ? CARVED : 1 + Math.floor(random() * shades)
    }
  }
}

function clampInt(v: number, lo: number, hi: number): number {
  return v < lo ? lo : v > hi ? hi : v
}

/**
 * Give each player their starting region: player 1 grows from the top-left
 * corner, player 2 from the bottom-right. Pass 1 for the one-region modes.
 *
 * Opposite corners are the only pair that starts both players the same distance
 * from everything, so neither opens ahead.
 *
 * A starting region is the corner cell plus every same-colored cell connected
 * to it, not the corner alone. Those cells are already indistinguishable from
 * the corner, so leaving them unowned would strand them the moment the region
 * repaints.
 */
export function seedOwners(board: Board, players: 1 | 2): void {
  const scratch = createMoveResult(board)
  board.owner.fill(UNOWNED)
  claimStartRegion(board, 1, scratch)
  if (players === 2) claimStartRegion(board, 2, scratch)
}

/** Claim a player's corner and everything the same color connected to it. */
function claimStartRegion(
  board: Board,
  player: PlayerId,
  scratch: MoveResult,
): void {
  board.owner[originIndex(board, player)] = player
  flood(board, player, regionColor(board, player), scratch)
}

/**
 * Repaint the bottom-right cell so the two corners differ.
 *
 * The territory contest cannot start both players inside one blob: they would
 * be the same region, and the second to claim would carve a hole out of the
 * first. Recoloring the one cell is enough to separate them, since a region is
 * a single color, and it perturbs a dealt board far less than rejecting the
 * whole deal.
 */
export function separateCorners(board: Board, random: () => number): void {
  const { color, numColors } = board
  const last = color.length - 1
  if (color[last] !== color[0]) return
  const shift = 1 + Math.floor(random() * (numColors - 1))
  color[last] = (color[0]! + shift) % numColors
}

/** The fixed cell a player's region grew from, and the flood's origin. */
function originIndex(board: Board, player: PlayerId): number {
  return player === 1 ? 0 : board.owner.length - 1
}

/** The single color a player's whole region currently shows. */
export function regionColor(board: Board, player: PlayerId): Color {
  return board.color[originIndex(board, player)]!
}

/** A result sized for `board`, ready to be reused across its moves. */
export function createMoveResult(board: Board): MoveResult {
  const total = board.cols * board.rows
  return {
    cells: new Int32Array(total),
    depth: new Int32Array(total),
    captured: new Uint8Array(total),
    count: 0,
    absorbed: 0,
    maxDepth: 0,
  }
}

/** An independent copy sharing no buffers. */
export function cloneBoard(board: Board): Board {
  return {
    cols: board.cols,
    rows: board.rows,
    numColors: board.numColors,
    color: board.color.slice(),
    owner: board.owner.slice(),
  }
}

/** Overwrite `dst`'s cells with `src`'s. Both must be the same size. */
function copyBoardInto(src: Board, dst: Board): void {
  dst.color.set(src.color)
  dst.owner.set(src.owner)
}

/**
 * Flood `player`'s region to `newColor` and swallow everything that now
 * matches. Returns false and leaves the board alone when the region already
 * shows that color, so a wasted tap never costs a move.
 *
 * `out` is filled with the touched cells in breadth-first order out from the
 * player's corner.
 *
 * @example
 *   const res = createMoveResult(board)
 *   if (applyMove(board, 1, 3, res)) movesUsed++
 */
export function applyMove(
  board: Board,
  player: PlayerId,
  newColor: Color,
  out: MoveResult,
): boolean {
  if (regionColor(board, player) === newColor) {
    out.count = 0
    out.absorbed = 0
    out.maxDepth = 0
    return false
  }
  flood(board, player, newColor, out)
  return true
}

/**
 * The walk itself, with no same-color guard, so claiming a starting region can
 * reuse it by flooding to the color the region already shows.
 */
function flood(
  board: Board,
  player: PlayerId,
  newColor: Color,
  out: MoveResult,
): void {
  const { cols, color, owner } = board
  const total = color.length
  const origin = originIndex(board, player)
  const { cells, depth, captured } = out
  let tail = 0
  let absorbed = 0
  let maxDepth = 0

  // The origin is held by definition, so it seeds the walk. Repainting it is
  // also what makes the visited test below work: from here on, a cell is done
  // exactly when the mover holds it AND it already shows the new color.
  color[origin] = newColor
  owner[origin] = player
  cells[tail] = origin
  depth[tail] = 0
  captured[tail] = 0
  tail++

  for (let head = 0; head < tail; head++) {
    const i = cells[head]!
    const d = depth[head]! + 1
    const col = i % cols
    for (let k = 0; k < 4; k++) {
      const nextCol = col + DX[k]!
      if (nextCol < 0 || nextCol >= cols) continue
      const j = i + DX[k]! + DY[k]! * cols
      if (j < 0 || j >= total) continue

      let taken: 0 | 1
      if (owner[j] === player) {
        if (color[j] === newColor) continue
        taken = 0
      } else if (owner[j] === UNOWNED && color[j] === newColor) {
        taken = 1
      } else {
        continue
      }

      color[j] = newColor
      owner[j] = player
      cells[tail] = j
      depth[tail] = d
      captured[tail] = taken
      tail++
      if (taken === 1) absorbed++
      if (d > maxDepth) maxDepth = d
    }
  }

  out.count = tail
  out.absorbed = absorbed
  out.maxDepth = maxDepth
}

/** How many cells `player` holds. */
export function ownedCount(board: Board, player: PlayerId): number {
  const owner = board.owner
  let n = 0
  for (let i = 0; i < owner.length; i++) if (owner[i] === player) n++
  return n
}

/** How many cells nobody holds. */
export function unownedCount(board: Board): number {
  const owner = board.owner
  let n = 0
  for (let i = 0; i < owner.length; i++) if (owner[i] === UNOWNED) n++
  return n
}

/** True once `player` holds the whole board. */
export function isFlooded(board: Board, player: PlayerId): boolean {
  return ownedCount(board, player) === board.owner.length
}

/**
 * True when no unowned cell touches `player`'s region, so they can never gain
 * another cell however they play.
 *
 * In the territory contest this decides the match: a walled-in player's
 * opponent will take everything that is left, so the result is already known.
 */
export function isBlocked(board: Board, player: PlayerId): boolean {
  const { cols, owner } = board
  const total = owner.length
  for (let i = 0; i < total; i++) {
    if (owner[i] !== player) continue
    const col = i % cols
    for (let k = 0; k < 4; k++) {
      const nextCol = col + DX[k]!
      if (nextCol < 0 || nextCol >= cols) continue
      const j = i + DX[k]! + DY[k]! * cols
      if (j < 0 || j >= total) continue
      if (owner[j] === UNOWNED) return false
    }
  }
  return true
}

/**
 * How many cells each color would take if `player` picked it now, written into
 * `out` (length `numColors`). `scratch` is a same-sized board used as the
 * sandbox, so `board` is never touched.
 *
 * Backs the greedy par estimate, and is the honest way to ask "what does this
 * tap do" without a special-cased copy of the flood.
 */
export function absorbGains(
  board: Board,
  player: PlayerId,
  scratch: Board,
  result: MoveResult,
  out: Int32Array,
): void {
  const current = regionColor(board, player)
  for (let c = 0; c < board.numColors; c++) {
    if (c === current) {
      out[c] = 0
      continue
    }
    copyBoardInto(board, scratch)
    applyMove(scratch, player, c, result)
    out[c] = result.absorbed
  }
}
