/**
 * Adversarial game search: negamax with alpha-beta pruning for two-player,
 * zero-sum, perfect-information games. Describe a game with
 * {@link AdversarialGame} and call {@link searchBestMove} to pick a move. The
 * state is mutated through `makeMove` / `unmakeMove` so a deep search allocates
 * nothing per node. See the AI guide for the negamax sign convention and a
 * difficulty recipe.
 *
 * @module ai
 * @category AI
 */
export { searchBestMove } from '../ai/minimax'
export type {
  AdversarialGame,
  SearchOptions,
  SearchResult,
} from '../ai/minimax'
