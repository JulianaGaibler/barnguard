/**
 * The German map's own tables. Ids are the ISO 3166-2:DE codes without the
 * `DE-` prefix, and they double as the i18n keys under `messages.states`.
 *
 * `StateId` stays a closed union here even though the shared layer passes
 * region ids as plain strings. Narrow where the data is authored, open where
 * maps are interchangeable: the union is what makes `ADJACENCY` and
 * `CITY_ID_TO_STATE_ID` exhaustive and catches a typo in either at compile
 * time.
 */

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
 * Path id in `de-cities.svg` to state. The city ids are ASCII-only
 * transliterations of the capital names because upstream SVG tooling mangles
 * non-ASCII characters (München became Munechen). Kept as source data so the
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
