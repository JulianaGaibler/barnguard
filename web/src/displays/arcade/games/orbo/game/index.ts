/**
 * Public entry point for the orbo game layer. `OrboGame.svelte` calls
 * `startGame(host)` to build the scene subtree + return the `GameSession`
 * control surface. Re-exported here so `import { startGame } from './game'`
 * stays stable as internals move.
 */
export {
  startGame,
  type GameEvents,
  type GameSession,
  type RoundResult,
  type SessionState,
} from './session'
export type {
  GameMode,
  MatchScore,
  OrbSize,
  QueuedOrbView,
  TeamCounts,
  TeamId,
} from './types'
