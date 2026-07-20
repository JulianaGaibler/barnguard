import { describe, expect, it } from 'vitest'
import { searchBestMove, type AdversarialGame } from './minimax'

/**
 * Tic-tac-toe as the fixture game. Cells are `0` empty / `1` / `2`; `turn` is
 * the side to move. Terminal loss scores `-(1000 - depthUnused)` — here just
 * `-1000` since depth isn't threaded into evaluate — which is enough for these
 * positions.
 */
interface TTT {
  cells: Int8Array
  turn: 1 | 2
  /** Pieces placed, used to prefer faster wins / slower losses. */
  ply: number
}

const LINES = [
  [0, 1, 2],
  [3, 4, 5],
  [6, 7, 8],
  [0, 3, 6],
  [1, 4, 7],
  [2, 5, 8],
  [0, 4, 8],
  [2, 4, 6],
]

function winner(c: Int8Array): 0 | 1 | 2 {
  for (const [a, b, d] of LINES) {
    if (c[a] !== 0 && c[a] === c[b] && c[b] === c[d]) return c[a] as 1 | 2
  }
  return 0
}

const ttt: AdversarialGame<TTT, number> = {
  moves(s) {
    if (winner(s.cells) !== 0) return []
    const out: number[] = []
    for (let i = 0; i < 9; i++) if (s.cells[i] === 0) out.push(i)
    return out
  },
  makeMove(s, i) {
    s.cells[i] = s.turn
    s.turn = s.turn === 1 ? 2 : 1
    s.ply += 1
  },
  unmakeMove(s, i) {
    s.ply -= 1
    s.turn = s.turn === 1 ? 2 : 1
    s.cells[i] = 0
  },
  isTerminal(s) {
    return winner(s.cells) !== 0 || s.cells.every((v) => v !== 0)
  },
  evaluate(s) {
    // Terminal states are reached right after a winning move, so the player to
    // move here is the loser. Offset by ply so a faster loss is worse than a
    // slower one (and, negated up the tree, a faster win beats a slower win).
    return winner(s.cells) !== 0 ? -(1000 - s.ply) : 0
  },
}

/** Build a state from a 9-char string ('.', '1', '2') with `turn` to move. */
function board(s: string, turn: 1 | 2): TTT {
  const cells = new Int8Array(9)
  let ply = 0
  for (let i = 0; i < 9; i++) {
    cells[i] = s[i] === '.' ? 0 : (Number(s[i]) as number)
    if (cells[i] !== 0) ply += 1
  }
  return { cells, turn, ply }
}

describe('searchBestMove (negamax + alpha-beta)', () => {
  it('takes the immediate winning move', () => {
    // X (1) to move: 0 and 1 are X, cell 2 completes the top row.
    const state = board('11.......', 1)
    const { move } = searchBestMove(ttt, state, { depth: 9 })
    expect(move).toBe(2)
  })

  it('blocks the opponent immediate win', () => {
    // X (1) to move with no win of its own; O (2) threatens 3,4,5 → must play 5.
    const state = board('1..22....', 1)
    const { move } = searchBestMove(ttt, state, { depth: 9 })
    expect(move).toBe(5)
  })

  it('never loses from the empty board at full depth (perfect play draws)', () => {
    const state = board('.........', 1)
    const { score } = searchBestMove(ttt, state, { depth: 9 })
    // A solved tic-tac-toe game is a draw; the root score is 0, not a loss.
    // (`=== 0` rather than `toBe`, since a negated 0 is `-0`.)
    expect(score === 0).toBe(true)
  })

  it('is deterministic with a fixed tie-break RNG and restores state', () => {
    const state = board('.........', 1)
    const rng = () => 0.5
    const a = searchBestMove(ttt, state, { depth: 6, random: rng })
    const b = searchBestMove(ttt, state, { depth: 6, random: rng })
    expect(a.move).toBe(b.move)
    // make/unmake must leave the board exactly as it was found.
    expect([...state.cells]).toEqual(new Array(9).fill(0))
    expect(state.turn).toBe(1)
  })

  it('reports a terminal position with no move', () => {
    const state = board('111......', 2) // 1 already won
    const { move, nodes } = searchBestMove(ttt, state, { depth: 4 })
    expect(move).toBeNull()
    expect(nodes).toBeGreaterThan(0)
  })
})
