/**
 * Public entry point for the booth game layer. The Svelte host mounts the
 * engine, then calls `startGame(host)` to build the scene + return the
 * `GameSession` control surface.
 *
 * Everything below is intentionally re-exported from more focused modules. This
 * file exists so `import { startGame } from '@src/displays/enterprise/game'`
 * stays stable as internals move around.
 */
export {
  startGame,
  type GameEvents,
  type GameOverReason,
  type GameSession,
  type SessionState,
} from './session'
export {
  DEFAULT_MAP_ID,
  knownMapIds,
  loadMap,
  resolveMapId,
  namespaceForMap,
  type MapDescriptor,
  type RegionId,
  type RegionInfo,
} from './maps'
