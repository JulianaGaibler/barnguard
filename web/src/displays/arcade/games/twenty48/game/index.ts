/**
 * The engine layer's public surface. Components import from here and never
 * reach deeper into `game/`.
 */
export { BoardSession, createSoloSession } from './session'
export { Match } from './match'
export { bindBoardSwipe } from './input'
export { computeDualSlots, computeSoloSlot } from './layout'
export { randomSeed } from './spawn'
export { ACCENT_SOLO, ACCENT_VS, GRADIENT } from './tuning'
export type { Bounds, GameMode, PlayerId } from './types'
