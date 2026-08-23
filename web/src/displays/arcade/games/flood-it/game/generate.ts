/**
 * Board generation and the move limit.
 *
 * The move limit is measured, not guessed. A random board is dealt, a greedy
 * solver plays it, and the limit is that count times a per-preset slack. The
 * additive `cols + rows + colors` rules of thumb are blind to the board they
 * are applied to, so with one seed they hand out a walkover and with the next
 * an impossible board. Measuring costs a fraction of a millisecond and makes
 * every board winnable and every preset feel the same from one round to the
 * next.
 *
 * A dealt board is also rejected and redealt when its par falls outside the
 * preset's band, which is what keeps a preset's difficulty steady rather than
 * merely solvable.
 */
import type { Random } from '../../common/rng'
import {
  absorbGains,
  applyMove,
  cloneBoard,
  createBoard,
  createMoveResult,
  fillRandom,
  isFlooded,
  seedOwners,
  separateCorners,
  type Board,
} from './board'
import { PRESETS, type Preset } from './tuning'
import type { PresetId } from './types'

/** How many deals to try before settling for the closest one. */
const MAX_ATTEMPTS = 24

/** A dealt board and what it takes to beat. */
export interface DealtBoard {
  board: Board
  /** Moves the greedy solver needed. */
  par: number
  /** Moves the player is allowed. */
  maxMoves: number
}

/**
 * Moves a greedy player needs to flood `board`: at every step, take the color
 * that swallows the most cells.
 *
 * Greedy is not optimal, which is the point. It is a stable, cheap yardstick
 * for how hard a particular deal is, and the preset's slack decides how much
 * better or worse than greedy a player has to be.
 *
 * `board` is not modified.
 */
export function greedySolve(board: Board): number {
  const work = cloneBoard(board)
  const trial = cloneBoard(board)
  const result = createMoveResult(board)
  const gains = new Int32Array(board.numColors)
  const total = board.color.length
  let moves = 0

  while (!isFlooded(work, 1) && moves <= total) {
    absorbGains(work, 1, trial, result, gains)
    const pick = bestGain(gains)
    // An unflooded board always leaves some cell touching the region, so a
    // gainful color always exists. Bailing out anyway keeps a malformed board
    // from spinning here.
    if (pick < 0) break
    applyMove(work, 1, pick, result)
    moves++
  }
  return moves
}

/** The color that takes the most cells, or -1 when none takes any. */
export function bestGain(gains: Int32Array): number {
  let best = -1
  let most = 0
  for (let c = 0; c < gains.length; c++) {
    if (gains[c]! > most) {
      most = gains[c]!
      best = c
    }
  }
  return best
}

/**
 * Deal a board for `preset`, redealing until its par lands inside the preset's
 * band. After {@link MAX_ATTEMPTS} the closest attempt is kept, so generation
 * always returns.
 *
 * `players` decides how many corners start owned: 1 for the puzzle modes, 2 for
 * the territory contest.
 *
 * @example
 *   const { board, maxMoves } = dealBoard('medium', seededRandom(7), 1)
 */
export function dealBoard(
  presetId: PresetId,
  random: Random,
  players: 1 | 2,
): DealtBoard {
  const preset = PRESETS[presetId]
  const board = createBoard(preset.cols, preset.rows, preset.colors)
  const measured = createBoard(preset.cols, preset.rows, preset.colors)

  let bestColors: Uint8Array | null = null
  let bestPar = 0
  let bestMiss = Infinity

  for (let attempt = 0; attempt < MAX_ATTEMPTS; attempt++) {
    fillRandom(board, random)
    if (players === 2) separateCorners(board, random)
    // Par is always measured as a one-region puzzle, so the territory contest
    // is dealt from the same distribution of boards as the puzzle modes.
    measured.color.set(board.color)
    seedOwners(measured, 1)
    const par = greedySolve(measured)
    if (par >= preset.parMin && par <= preset.parMax) {
      seedOwners(board, players)
      return { board, par, maxMoves: moveLimit(par, preset) }
    }
    const miss = par < preset.parMin ? preset.parMin - par : par - preset.parMax
    if (miss < bestMiss) {
      bestMiss = miss
      bestPar = par
      bestColors = board.color.slice()
    }
  }

  if (bestColors) board.color.set(bestColors)
  seedOwners(board, players)
  return { board, par: bestPar, maxMoves: moveLimit(bestPar, preset) }
}

/** The allowance a player gets for a board greedy beat in `par`. */
function moveLimit(par: number, preset: Preset): number {
  return Math.max(par, Math.ceil(par * preset.slack))
}
