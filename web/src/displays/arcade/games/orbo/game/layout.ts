/**
 * Horizontal field geometry + zone tests. The reference board was vertical (4
 * bands stacked top→bottom); this is the same model rotated to landscape, so
 * the four bands run left→right across the width:
 *
 *     | leftStrip 15% | leftCenter 35% | rightCenter 35% | rightStrip 15% |
 *        Team L launch      Team R's          Team L's          Team R launch
 *        / return zone    scoring band      scoring band      / return zone
 *
 * - Team L (`team 0`) launches from `leftStrip`, flicks right, scores in
 *   `rightCenter`. Team R (`team 1`) launches from `rightStrip`, scores in
 *   `leftCenter`.
 * - A launch strip "returns" a settled orb to the team that owns it: `leftStrip`
 *   → Team L, `rightStrip` → Team R. So overshooting into the enemy strip is
 *   captured by them; rolling back into your own strip returns to you.
 */
import { THROW_ZONE_FRACTION } from './tuning'
import type { Orb } from './Orb'
import type { TeamId } from './types'

export type ZoneKind = 'leftStrip' | 'leftCenter' | 'rightCenter' | 'rightStrip'

export interface FieldLayout {
  width: number
  height: number
  /** X at the right edge of `leftStrip`. */
  leftStripEnd: number
  /** X at the center line (border between the two scoring bands). */
  centerX: number
  /** X at the left edge of `rightStrip`. */
  rightStripStart: number
}

export function calculateLayout(width: number, height: number): FieldLayout {
  const strip = width * THROW_ZONE_FRACTION
  return {
    width,
    height,
    leftStripEnd: strip,
    centerX: width / 2,
    rightStripStart: width - strip,
  }
}

/** Which band an x coordinate falls in. */
export function zoneAtX(layout: FieldLayout, x: number): ZoneKind {
  if (x < layout.leftStripEnd) return 'leftStrip'
  if (x < layout.centerX) return 'leftCenter'
  if (x < layout.rightStripStart) return 'rightCenter'
  return 'rightStrip'
}

/** The scoring band a team must land in to count. */
export function scoringZoneForTeam(team: TeamId): ZoneKind {
  return team === 0 ? 'rightCenter' : 'leftCenter'
}

/**
 * The team a launch strip returns/captures a settled orb for, or null if not a
 * strip.
 */
export function returnTeamForZone(zone: ZoneKind): TeamId | null {
  if (zone === 'leftStrip') return 0
  if (zone === 'rightStrip') return 1
  return null
}

/** True when the orb rests in the scoring band that counts for its team. */
export function isInOwnScoringBand(layout: FieldLayout, body: Orb): boolean {
  return zoneAtX(layout, body.x) === scoringZoneForTeam(body.team)
}

/** Center x of a team's launch strip. */
export function launchStripCenterX(layout: FieldLayout, team: TeamId): number {
  return team === 0
    ? layout.leftStripEnd / 2
    : (layout.rightStripStart + layout.width) / 2
}

/**
 * The x boundary a dragged orb crosses to auto-launch (the inner edge of its
 * own strip), plus the sign the launch velocity must have to point into the
 * playfield (`+1` for Team L flicking right, `-1` for Team R flicking left).
 */
export function launchBoundary(
  layout: FieldLayout,
  team: TeamId,
): { x: number; dir: 1 | -1 } {
  return team === 0
    ? { x: layout.leftStripEnd, dir: 1 }
    : { x: layout.rightStripStart, dir: -1 }
}
