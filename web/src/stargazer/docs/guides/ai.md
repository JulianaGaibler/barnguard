# Adversarial game search

`searchBestMove` picks a move for two-player, zero-sum, perfect-information games such as tic-tac-toe, Connect Four, and checkers. It runs negamax with alpha-beta pruning and knows nothing about scenes, rendering, or time, so it works the same in a game loop or a test.

You describe your game with `AdversarialGame<S, M>`, where `S` is the state and `M` is a move:

```ts
import { searchBestMove, type AdversarialGame } from '@src/stargazer'

const game: AdversarialGame<State, Move> = {
  moves, // legal moves, best-guess-first
  makeMove, // mutate the state to the successor
  unmakeMove, // exactly undo the matching makeMove
  isTerminal, // win / loss / draw reached
  evaluate, // score for the player to move
}

const { move, score, nodes } = searchBestMove(game, state, { depth: 6 })
```

## Make and unmake, not clone

The state is mutated in place and then restored, rather than copied at every node. A depth-7 Connect Four search visits tens of thousands of positions, and cloning a board at each would churn the garbage collector and stutter on weaker devices. `makeMove` and `unmakeMove` are called in strict last-in-first-out order as the search descends and unwinds, so the pair only needs to be an exact inverse; it never has to reconstruct arbitrary history. In Connect Four each is O(1): drop a piece and bump the column height, or clear that cell and drop the height back.

## The negamax sign convention

`evaluate` and every score returned are from the point of view of the player whose turn it is in that state. One player's gain is the other's loss, so the search negates the score each time it goes down a ply. That single rule lets one routine play both sides.

The sign trips people up at terminal states. Games like Connect Four end on the move that completes a line, so once you reach a finished position the player "to move" is the one who just lost. Return a large negative number for that, offset by depth so a faster loss is worse than a slower one:

```ts
function evaluate(state: State): number {
  if (justLost(state)) return -(WIN - state.movesPlayed) // large negative
  if (isDraw(state)) return 0
  return heuristic(state) // small, side-to-move relative
}
```

The negation on the way up turns that loss into the large positive score of the winning move, and the depth offset makes the search prefer winning sooner and losing later.

## Move ordering

`moves` should return stronger candidates first. Alpha-beta prunes a branch as soon as it finds the opponent has a reply good enough to avoid it, so trying good moves early cuts more of the tree. In Connect Four, listing columns center-first is enough to roughly halve the work.

## Difficulty

Keep the search itself sharp and set difficulty in your game layer, not in `searchBestMove`. Two knobs cover most needs:

- Search depth. Shallower play sees fewer threats. Connect Four feels easy around depth 2, competent around 4, and strong around 7.
- A flat blunder chance for the easiest levels: before searching, with some probability play a random legal move instead. This is more natural than picking a near-best move by score, because a move that scores only slightly below the best can still be the one that hands over an immediate win. A clean random blunder keeps easy mode beatable without those swings.

```ts
function chooseMove(state: State, difficulty: Difficulty): Move {
  const { depth, blunderChance } = LEVELS[difficulty]
  if (blunderChance > 0 && Math.random() < blunderChance) {
    const legal = game.moves(state)
    return legal[Math.floor(Math.random() * legal.length)]
  }
  return searchBestMove(game, state, { depth }).move!
}
```

## Determinism

Ties between equally scored moves are broken with `SearchOptions.random` (defaulting to `Math.random`), so the opponent varies its play. Pass a seeded generator to make a search reproducible in tests. `searchBestMove` leaves the state exactly as it found it, so you can search straight on your live board if you want, though cloning once per decision keeps the live state untouched while the search runs.
