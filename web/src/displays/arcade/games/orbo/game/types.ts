/**
 * Shared value types for the orbo game layer. Kept dependency-free so the
 * physics world, layout math, scene nodes, and session can all import from here
 * without cycles.
 */

/** Two teams: `0` = Team L (launches from the left strip), `1` = Team R. */
export type TeamId = 0 | 1

/** Orb size class. Radius/mass/starting-count are looked up in `tuning.ts`. */
export type OrbSize = 'SMALL' | 'MEDIUM' | 'LARGE'

/** 2-player or 4-player match. `team = playerId % 2` in both modes. */
export type GameMode = '1v1' | '2v2'

/**
 * The physics body for an orb now lives in `Orb` (a stargazer `Body` subclass);
 * see `./Orb`. This module keeps only the dependency-free value types.
 */

/** An orb waiting in a player's queue (no physics state yet). */
export interface QueuedOrb {
  /** Stable id so the UI indicator can key + animate add/remove. */
  id: string
  size: OrbSize
  lifetimeRemaining: number
}

/** Minimal queue projection handed to the UI for the bottom indicator strips. */
export interface QueuedOrbView {
  id: string
  size: OrbSize
}

/** A seat at the table. `color` is the orb fill (authoritative CSS hex). */
export interface PlayerState {
  id: number
  team: TeamId
  color: string
}

/** Cumulative cross-round score, held in memory and resettable from the UI. */
export interface MatchScore {
  teamL: number
  teamR: number
}

/** Per-team count of scoring orbs at the end of a round. */
export interface TeamCounts {
  teamL: number
  teamR: number
}
