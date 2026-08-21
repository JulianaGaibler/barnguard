/** Public surface of the Office Overtime engine layer. */
export { startGame, type GameSession } from './session'
export type {
  GameEvents,
  GameMode,
  GameOverView,
  ScoreLine,
  SessionState,
  SideResultView,
  SideSummary,
} from './types'
export { AI_PROFILES, type Difficulty } from './tuning'
