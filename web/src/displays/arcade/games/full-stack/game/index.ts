/** Public surface of the Full Stack engine layer. */
export { startGame, type GameSession } from './session'
export { centreColumn, helpFocus } from './layout'
export type {
  ChoicePrompt,
  GameEvents,
  GameMode,
  GameOverView,
  ScoreLine,
  SessionState,
  SideResultView,
  SideSummary,
} from './types'
export { AI_PROFILES, type Difficulty } from './tuning'
export type { Card } from './rules/deck'
