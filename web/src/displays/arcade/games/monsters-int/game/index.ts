/**
 * Public entry points for Monsters, Int's engine layer.
 *
 * The Svelte component builds and drives the table through these, so the import
 * path stays put as the internals move. Deliberately only what the component
 * needs.
 */
export { buildScene } from './scene'
export type { SceneHandle, SceneOptions } from './scene'
export { seatPlacements } from './seats'
export type { SeatCount, SeatPlacement } from './seats'
export { COLORS, SEATS, seatName } from './tuning'
export type { SeatIdentity, SeatShape } from './tuning'
export { startSession } from './session'
export type {
  GameOver,
  RoundSummary,
  Session,
  SessionScene,
  TargetPrompt,
  TurnPrompt,
} from './session'
export type { SeatHud } from './nodes/HudNode'
export { TARGET_SCORE } from './rules/match'
export type { Standing } from './rules/match'
export type { RoundScore, SeatId } from './rules/player'
