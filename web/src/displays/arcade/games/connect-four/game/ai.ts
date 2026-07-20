/**
 * Connect Four AI. Wraps the pure board rules as an `AdversarialGame` for
 * stargazer's `searchBestMove`, and maps difficulty to search depth plus a
 * blunder chance for the easy level. The search runs make/unmake straight on a
 * scratch board, so a decision clones the live board once, never per node.
 */
import { searchBestMove, type AdversarialGame } from '@src/stargazer'
import {
  COLS,
  ROWS,
  CONNECT,
  cellAt,
  cloneBoard,
  isFull,
  legalColumns,
  makeMove,
  unmakeMove,
  type Board,
} from './board'
import type { Difficulty } from './types'
import { AI_LEVELS } from './tuning'

/** Terminal magnitude; dwarfs any heuristic so a real win/loss always dominates. */
const WIN = 100_000

const game: AdversarialGame<Board, number> = {
  moves: (b) => legalColumns(b),
  makeMove: (b, col) => makeMove(b, col),
  unmakeMove: (b, col) => unmakeMove(b, col),
  isTerminal: (b) => b.winner !== 0 || isFull(b),
  evaluate,
}

/**
 * Score from the side-to-move's view. A set `winner` means the OTHER player
 * just completed a line, so the side to move has lost; return a large negative
 * offset by `ply` so a faster loss is worse (and, negated up the tree, a faster
 * win is better). See the stargazer AI guide.
 */
function evaluate(b: Board): number {
  if (b.winner !== 0) return -(WIN - b.ply)
  if (isFull(b)) return 0
  const me = b.turn
  const opp = me === 1 ? 2 : 1
  return heuristic(b, me) - heuristic(b, opp)
}

/** Sum of open-window potential for `player`, plus a center-column bias. */
function heuristic(b: Board, player: number): number {
  let score = 0
  // Center column control is worth a little on its own.
  const center = (COLS - 1) / 2
  for (let row = 0; row < ROWS; row++) {
    if (cellAt(b, center, row) === player) score += 3
  }
  // Every length-CONNECT window, in all four directions.
  for (let row = 0; row < ROWS; row++) {
    for (let col = 0; col < COLS; col++) {
      score += windowScore(b, col, row, 1, 0, player)
      score += windowScore(b, col, row, 0, 1, player)
      score += windowScore(b, col, row, 1, 1, player)
      score += windowScore(b, col, row, 1, -1, player)
    }
  }
  return score
}

function windowScore(
  b: Board,
  col: number,
  row: number,
  dc: number,
  dr: number,
  player: number,
): number {
  const endC = col + dc * (CONNECT - 1)
  const endR = row + dr * (CONNECT - 1)
  if (endC < 0 || endC >= COLS || endR < 0 || endR >= ROWS) return 0
  let mine = 0
  let empty = 0
  for (let i = 0; i < CONNECT; i++) {
    const v = cellAt(b, col + dc * i, row + dr * i)
    if (v === player) mine += 1
    else if (v === 0) empty += 1
    else return 0 // window blocked by the opponent, no potential
  }
  if (mine === 3 && empty === 1) return 50
  if (mine === 2 && empty === 2) return 10
  if (mine === 1 && empty === 3) return 1
  return 0
}

/**
 * Pick a column for the side to move on `liveBoard` at the given difficulty.
 * `liveBoard` is not modified. Returns a legal column, or -1 if the board is
 * full.
 */
export function chooseColumn(
  liveBoard: Board,
  difficulty: Difficulty,
  random: () => number = Math.random,
): number {
  const legal = legalColumns(liveBoard)
  if (legal.length === 0) return -1
  const { depth, blunderChance } = AI_LEVELS[difficulty]
  if (blunderChance > 0 && random() < blunderChance) {
    return legal[Math.floor(random() * legal.length)]
  }
  const scratch = cloneBoard(liveBoard)
  const { move } = searchBestMove(game, scratch, { depth, random })
  return move ?? legal[0]
}
