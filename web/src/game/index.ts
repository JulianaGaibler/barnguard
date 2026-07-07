/**
 * Public entry point for the booth game layer. The Svelte host mounts the
 * engine, then calls `startGame(host)` to build the scene + return the
 * `GameSession` control surface.
 *
 * Everything below is intentionally re-exported from more focused modules; this
 * file exists so `import { startGame } from '@src/game'` stays stable as
 * internals move around.
 */
export {
  startGame,
  type GameEvents,
  type GameOverReason,
  type GameSession,
  type SessionState,
} from './session'
export type { StateId } from './data/states'
