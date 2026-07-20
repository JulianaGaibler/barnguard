/**
 * Negamax search with alpha-beta pruning for two-player, zero-sum, perfect-
 * information games (tic-tac-toe, Connect Four, checkers, and the like). The
 * search is engine-agnostic: it knows nothing about scenes, rendering, or time.
 * You describe your game with {@link AdversarialGame} and call
 * {@link searchBestMove}.
 *
 * The game state is mutated in place through `makeMove` / `unmakeMove` rather
 * than cloned, so a deep search allocates nothing per node. A depth-7 Connect
 * Four search visits tens of thousands of positions; cloning a board at each
 * would churn the garbage collector and stutter on weaker devices.
 *
 * @module ai
 * @category AI
 */

/**
 * A two-player, zero-sum game described for {@link searchBestMove}. `S` is the
 * mutable game state; `M` is a move.
 *
 * The two players alternate. `evaluate` and the returned scores are always from
 * the point of view of the player whose turn it is in the given state (the
 * negamax convention), which is what lets one recursive routine serve both
 * players by negating scores as it descends.
 *
 * @category AI
 */
export interface AdversarialGame<S, M> {
  /**
   * Legal moves in `state`, or an empty array when there are none. Order them
   * best-guess-first (for example, center columns first in Connect Four): good
   * moves early make alpha-beta prune more.
   */
  moves(state: S): M[]
  /**
   * Mutate `state` in place to the position after the side to move plays
   * `move`.
   */
  makeMove(state: S, move: M): void
  /**
   * Exactly reverse the matching `makeMove(state, move)`, restoring `state`.
   * Called in strict last-in-first-out order as the search unwinds.
   */
  unmakeMove(state: S, move: M): void
  /** True when `state` is over (someone has won, or it is a draw). */
  isTerminal(state: S): boolean
  /**
   * Score `state` from the perspective of the player to move: positive is good
   * for them, negative is good for the opponent.
   *
   * Games like Connect Four end on the move that completes a line, so in a
   * terminal state the player "to move" is the one who just lost. Return a
   * large negative value for that loss, offset by depth so a faster loss is
   * worse than a slower one, e.g. `-(WIN - depthRemaining)`. The negation on
   * the way up then turns it into the large positive score of the winning move.
   * See the module guide for a worked example.
   */
  evaluate(state: S): number
}

/**
 * Tuning for a single {@link searchBestMove} call.
 *
 * @category AI
 */
export interface SearchOptions {
  /** Plies to look ahead. `0` just evaluates the current position. */
  depth: number
  /**
   * Random source in `[0, 1)` used only to break ties between equally scored
   * moves, so the opponent doesn't always play the same game. Defaults to
   * `Math.random`; pass a seeded generator for deterministic tests.
   */
  random?: () => number
}

/**
 * The chosen move and why.
 *
 * @category AI
 */
export interface SearchResult<M> {
  /** Best move found, or `null` when the position is terminal or has no moves. */
  move: M | null
  /** Score of that move, from the searching player's perspective. */
  score: number
  /** Positions visited. Handy for tuning depth against a frame budget. */
  nodes: number
}

const NEG_INF = -Infinity
const POS_INF = Infinity

/**
 * Pick the best move for the player to move in `state`.
 *
 * @example
 *   // A 3x3 tic-tac-toe adapter. The board is a 9-cell array (`0` empty,
 *   // `1`/`2` players); `turn` is the side to move.
 *   import { searchBestMove, type AdversarialGame } from '@src/stargazer'
 *
 *   interface TTT {
 *     cells: Int8Array
 *     turn: 1 | 2
 *   }
 *   const LINES = [
 *     [0, 1, 2],
 *     [3, 4, 5],
 *     [6, 7, 8],
 *     [0, 3, 6],
 *     [1, 4, 7],
 *     [2, 5, 8],
 *     [0, 4, 8],
 *     [2, 4, 6],
 *   ]
 *   const winner = (c: Int8Array) =>
 *     LINES.find(
 *       (l) => c[l[0]] && c[l[0]] === c[l[1]] && c[l[1]] === c[l[2]],
 *     )
 *       ? c[
 *           LINES.find(
 *             (l) => c[l[0]] && c[l[0]] === c[l[1]] && c[l[1]] === c[l[2]],
 *           )![0]
 *         ]
 *       : 0
 *
 *   const ttt: AdversarialGame<TTT, number> = {
 *     moves: (s) =>
 *       [...s.cells].map((v, i) => (v ? -1 : i)).filter((i) => i >= 0),
 *     makeMove: (s, i) => {
 *       s.cells[i] = s.turn
 *       s.turn = s.turn === 1 ? 2 : 1
 *     },
 *     unmakeMove: (s, i) => {
 *       s.turn = s.turn === 1 ? 2 : 1
 *       s.cells[i] = 0
 *     },
 *     isTerminal: (s) =>
 *       winner(s.cells) !== 0 || s.cells.every((v) => v !== 0),
 *     evaluate: (s) => {
 *       // In a terminal state the mover is the loser (the opponent just won).
 *       const w = winner(s.cells)
 *       if (w !== 0) return -1000 // a draw evaluates to 0
 *       return 0
 *     },
 *   }
 *
 *   const state: TTT = { cells: new Int8Array(9), turn: 1 }
 *   const { move } = searchBestMove(ttt, state, { depth: 9 })
 */
export function searchBestMove<S, M>(
  game: AdversarialGame<S, M>,
  state: S,
  opts: SearchOptions,
): SearchResult<M> {
  const random = opts.random ?? Math.random
  const counter = { nodes: 0 }

  const moves = game.moves(state)
  if (moves.length === 0 || game.isTerminal(state)) {
    return { move: null, score: game.evaluate(state), nodes: 1 }
  }

  let bestMove: M = moves[0]
  let bestScore = NEG_INF
  let ties = 0

  // Each root move is searched with a full window so its returned score is
  // exact. Tightening the window with the running best (root-level alpha-beta)
  // would let inferior moves fail-high and come back as a BOUND equal to the
  // best score, creating false ties that the tie-break could then pick. Pruning
  // still happens inside each subtree, so the cost is small (a handful of root
  // moves).
  for (const move of moves) {
    game.makeMove(state, move)
    const score = -negamax(
      game,
      state,
      opts.depth - 1,
      NEG_INF,
      POS_INF,
      counter,
    )
    game.unmakeMove(state, move)

    if (score > bestScore) {
      bestScore = score
      bestMove = move
      ties = 1
    } else if (score === bestScore) {
      // Reservoir pick among genuinely equal-scored moves so play varies.
      ties += 1
      if (random() < 1 / ties) bestMove = move
    }
  }

  return { move: bestMove, score: bestScore, nodes: counter.nodes }
}

function negamax<S, M>(
  game: AdversarialGame<S, M>,
  state: S,
  depth: number,
  alpha: number,
  beta: number,
  counter: { nodes: number },
): number {
  counter.nodes += 1
  if (depth <= 0 || game.isTerminal(state)) return game.evaluate(state)

  const moves = game.moves(state)
  if (moves.length === 0) return game.evaluate(state)

  let best = NEG_INF
  for (const move of moves) {
    game.makeMove(state, move)
    const score = -negamax(game, state, depth - 1, -beta, -alpha, counter)
    game.unmakeMove(state, move)
    if (score > best) best = score
    if (best > alpha) alpha = best
    if (alpha >= beta) break // opponent won't allow this line; prune
  }
  return best
}
