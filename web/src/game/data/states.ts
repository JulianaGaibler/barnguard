import type { Vec2 } from '@src/stargazer'
import type { Messages } from '@src/i18n/types'

export const STATE_IDS = [
  'BW',
  'BY',
  'BE',
  'BB',
  'HB',
  'HH',
  'HE',
  'MV',
  'NI',
  'NW',
  'RP',
  'SL',
  'SN',
  'ST',
  'SH',
  'TH',
] as const

export type StateId = (typeof STATE_IDS)[number]

/**
 * Static per-state metadata. `capitalWorld`, `stateCenter`, and `half` are
 * filled at load time from parsed SVG geometry, declared nullable here so the
 * record is exhaustive before the maps parse. `capitalWorld` comes from the
 * circle centres in `de-cities.svg`; `stateCenter` + `half` come from
 * `de-states.svg` AABBs.
 */
export interface StateInfo {
  id: StateId
  /** I18n key under `states.`, e.g. `'BW'` → `messages.states.BW`. */
  i18nKey: keyof Messages['states']
  /** World coord of the capital. Populated at load time from `de-cities.svg`. */
  capitalWorld: Vec2 | null
  /** AABB center of the state's Path2D, filled from `de-states.svg`. */
  stateCenter: Vec2 | null
  /**
   * Which half of Germany the state sits in, used to pick between the
   * upper-half and lower-half camera framing after selection. Assigned once
   * geometry loads (state center y < viewBox/2 → upper).
   */
  half: 'upper' | 'lower' | null
}

/**
 * Path-id in `de-cities.svg` → canonical `StateId`. IDs use ASCII-only
 * transliterations of the capital names because upstream SVG tooling mangles
 * non-ASCII characters (München → Munechen, etc.). Kept as source data so the
 * SVG can be regenerated without renaming its paths.
 */
export const CITY_ID_TO_STATE_ID: Record<string, StateId> = {
  Berlin: 'BE',
  Potsdam: 'BB',
  Bremen: 'HB',
  Hamburg: 'HH',
  Kiel: 'SH',
  Munechen: 'BY',
  Stuttgart: 'BW',
  Saarbruecken: 'SL',
  Mainz: 'RP',
  Wiesbaden: 'HE',
  Dueseldorf: 'NW',
  Erfurt: 'TH',
  Hannover: 'NI',
  Magdeburg: 'ST',
  Dresden: 'SN',
  Schwerin: 'MV',
}

/**
 * All 16 German states, ordered alphabetically by ISO code so the table is
 * scannable. Neighbors + full names live in `adjacency.ts` and i18n.
 */
export const STATES: StateInfo[] = STATE_IDS.map((id) => ({
  id,
  i18nKey: id,
  capitalWorld: null,
  stateCenter: null,
  half: null,
}))

/**
 * Lookup by id, throws if not found. Consumers should always use canonical
 * `StateId` values, so a missing lookup is a programmer error, not user data.
 */
export function findState(id: StateId): StateInfo {
  const s = STATES.find((entry) => entry.id === id)
  if (!s) throw new Error(`states: unknown id ${id}`)
  return s
}
