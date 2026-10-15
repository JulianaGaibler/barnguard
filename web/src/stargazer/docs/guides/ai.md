---
title: Adversarial search
group: Features
order: 20
---

# Adversarial game search

{@link searchBestMove} picks a move for a computer opponent in a two-player, zero-sum game with perfect information, such as tic-tac-toe, Connect Four, or checkers. Zero-sum means one player's gain is the other's loss. Perfect information means both players see the whole state.

The search is negamax with alpha-beta pruning. It knows nothing about scenes, rendering, or time, so it works the same in a game loop and in a test. You describe your game with an {@link AdversarialGame} object and call `searchBestMove` with a search depth.

## Basic usage

The example below describes tic-tac-toe and asks for the best move for the player to move.

```ts
import { searchBestMove, type AdversarialGame } from '@src/stargazer'

interface Board {
  cells: Int8Array // 0 empty, 1 or 2 for a player
  turn: 1 | 2
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

function hasLine(c: Int8Array): boolean {
  return LINES.some(([a, b, d]) => c[a] !== 0 && c[a] === c[b] && c[b] === c[d])
}

const ticTacToe: AdversarialGame<Board, number> = {
  moves: (s) => [4, 0, 2, 6, 8, 1, 3, 5, 7].filter((i) => s.cells[i] === 0),
  makeMove: (s, i) => {
    s.cells[i] = s.turn
    s.turn = s.turn === 1 ? 2 : 1
  },
  unmakeMove: (s, i) => {
    s.turn = s.turn === 1 ? 2 : 1
    s.cells[i] = 0
  },
  isTerminal: (s) => hasLine(s.cells) || s.cells.every((v) => v !== 0),
  // A line on the board means the player to move just lost.
  evaluate: (s) => (hasLine(s.cells) ? -1 : 0),
}

const board: Board = { cells: new Int8Array(9), turn: 1 }
const { move, score, nodes } = searchBestMove(ticTacToe, board, { depth: 9 })
```

`move` is the chosen cell, or `null` when the game is over or has no legal moves. `score` is the value of that move for the player to move. `nodes` is the number of positions the search visited. The search leaves `board` as it found it.

### The game interface

An {@link AdversarialGame} has five functions. `S` is your state type and `M` is your move type.

- `moves(state)` returns the legal moves, best guess first, or an empty array.
- `makeMove(state, move)` changes the state in place to the position after the move.
- `unmakeMove(state, move)` exactly undoes the matching `makeMove`.
- `isTerminal(state)` returns `true` when someone has won or the game is a draw.
- `evaluate(state)` scores the state for the player to move. Positive is good for that player.

### Choosing a depth

{@link SearchOptions} has `depth`, the number of moves to look ahead, counting both players. A deeper search sees more threats but visits many more positions. The search is synchronous, so a large depth blocks the frame. Use `nodes` to tune the depth against your frame budget on the slowest device you support.

## Advanced usage

This section covers the scoring convention, why the search changes the state in place, move ordering, difficulty, and ties.

### The negamax sign convention

`evaluate` and every score are from the point of view of the player whose turn it is. The search negates the score each time it goes down a move. That one rule lets the same function play both sides.

The sign matters most at the end of the game. In many games the game ends on the move that completes a line. In a finished position, the player to move is then the one who just lost. Return a large negative number for that, offset by the move count so a fast loss scores worse than a slow one:

```ts
function evaluate(state: State): number {
  if (justLost(state)) return -(WIN - state.movesPlayed)
  if (isDraw(state)) return 0
  return heuristic(state) // small, for the player to move
}
```

The negation on the way up turns that loss into a large positive score for the winning move. The offset makes the search prefer winning sooner and losing later.

### Make and unmake

The search changes the state in place and restores it, instead of copying it at every position. A deep search visits tens of thousands of positions, and a copy at each one makes a lot of garbage. The search calls `makeMove` and `unmakeMove` in strict last-in, first-out order, so `unmakeMove` only has to reverse the last move. In a column-drop game, for example, each is one write: drop a piece and raise the column height, or clear the cell and lower it again.

Because the search is synchronous and restores the state, you can search your live board. Nothing else sees the state while the search runs.

### Move ordering

Return stronger moves first from `moves`. Alpha-beta pruning skips a branch once it finds that the opponent has a reply good enough to avoid it. Good moves early find those replies sooner, so the search visits fewer positions. In the example, the center and corners come first.

### Difficulty

Keep the search itself exact and set difficulty in your game code. Two settings cover most needs:

- A shallower depth, so the opponent sees fewer threats.
- A chance to play a random legal move instead of searching, for the easiest levels.

A random move works better than picking a move that scores slightly below the best. A move that scores only a little lower can still hand the player an immediate win.

```ts
function chooseMove(state: State, depth: number, blunderChance: number): Move {
  if (Math.random() < blunderChance) {
    const legal = game.moves(state)
    return legal[Math.floor(Math.random() * legal.length)]
  }
  return searchBestMove(game, state, { depth }).move!
}
```

### Ties and reproducible tests

When several moves share the best score, the search picks one of them at random, each with the same chance. This way the opponent doesn't play the same game every time. `SearchOptions.random` sets the random source, which defaults to `Math.random`. Pass a seeded generator to make a search reproducible in tests.

## See also

- {@link searchBestMove}: picks the best move for the player to move
- {@link AdversarialGame}: the five functions that describe a game
- {@link SearchOptions}: depth and the tie-break random source
- {@link SearchResult}: the chosen move, its score, and positions visited
