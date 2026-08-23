/**
 * A greedy player, used by the menu preview and the tutorial demos so both show
 * a real board being played rather than a scripted animation.
 *
 * It is deliberately simple: prefer the move that merges the most, break ties
 * toward keeping the biggest tile in one corner. That is enough to build a
 * board that looks like someone competent is playing, and it costs nothing to
 * maintain because it runs on the same {@link move} the game does.
 */
import { move, occupancy } from './rules'
import { CELLS, type BoardState, type Direction, SIZE } from './types'

/** Move order, so a tie falls toward packing the top-left corner. */
const PREFERENCE: Direction[] = ['left', 'up', 'right', 'down']

/** How good a board looks: merged value, plus a nudge toward one full corner. */
function scoreOf(state: BoardState, gained: number): number {
  const cells = occupancy(state)
  let corner = 0
  for (let i = 0; i < CELLS; i++) {
    const tile = cells[i]
    if (!tile) continue
    const col = i % SIZE
    const row = Math.floor(i / SIZE)
    // Weight tiles toward the top-left, so big values gather in one place.
    corner += tile.value / (1 + col + row)
  }
  return gained * 8 + corner
}

/** The best move for `state`, or `null` when the board is stuck. */
export function chooseMove(state: BoardState): Direction | null {
  let best: Direction | null = null
  let bestScore = -Infinity
  for (const dir of PREFERENCE) {
    const result = move(state, dir)
    if (!result.moved) continue
    const s = scoreOf(result.state, result.gained)
    if (s > bestScore) {
      bestScore = s
      best = dir
    }
  }
  return best
}
