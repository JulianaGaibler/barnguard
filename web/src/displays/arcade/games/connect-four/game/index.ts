/**
 * Public entry point for the Connect Four game layer. `ConnectFourGame.svelte`
 * calls `startGame(host, bounds)` to build the scene and get the `GameSession`
 * control surface. Re-exported here so imports stay stable as internals move.
 */
export {
  startGame,
  type GameEvents,
  type GameSession,
  type RoundResult,
  type SessionState,
} from './session'
export type { Difficulty, GameMode, MatchScore, Player } from './types'
