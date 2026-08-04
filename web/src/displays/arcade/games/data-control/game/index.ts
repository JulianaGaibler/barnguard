/**
 * Public entry point for the Data Control game layer. The Svelte component
 * calls `startGame(host, camera)` to attach the scene subtree to the shared
 * arcade engine and returns the `GameSession` control surface.
 *
 * Everything below is intentionally re-exported from more focused modules; this
 * file exists so the stable import path stays put as internals move around.
 */
export {
  startGame,
  type GameEvents,
  type GameOverReason,
  type GameSession,
  type SessionState,
} from './session'
export type { StateId } from './data/states'
