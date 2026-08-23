/**
 * Public entry points for Flood It's engine layer. The Svelte component builds
 * boards, scenes and input through these, so the stable import path stays put
 * as the internals move around.
 *
 * Deliberately only what the component needs. The pure rule and layout modules
 * are imported directly where something else wants them, which keeps this from
 * becoming a second copy of every module's surface.
 */
export { PuzzleSession } from './session'
export type { PuzzleState } from './session'
export { RaceMatch } from './race'
export type { RaceResult } from './race'
export { TerritorySession } from './territory'
export type { TerritoryEnding } from './territory'
export {
  computeFieldGeom,
  computeRaceSlots,
  computeSoloSlot,
  computeTerritorySlots,
  sideMargins,
} from './layout'
export type { Slot } from './layout'
export { BoardNode } from './nodes/BoardNode'
export type { RegionStyle } from './nodes/BoardNode'
export { SwatchBarNode } from './nodes/SwatchBarNode'
export {
  ChromeButtonNode,
  MoveMeterNode,
  NoticeNode,
  TallyNode,
} from './nodes/HudNodes'
export { ACCENT, ANIM, COLORS } from './tuning'
export type { Bounds, GameMode, PlayerId, PresetId } from './types'
