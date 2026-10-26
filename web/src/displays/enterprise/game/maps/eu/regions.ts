/**
 * The European map's own tables, mapping a path key in `eu-countries.svg` to a
 * region id.
 *
 * Path keys carry a `g` prefix from the export tool, and two of them are
 * suffixed rather than named after their country (`gFI1`, `gFR1`), so the
 * mapping is spelled out instead of derived. Region ids are ISO 3166-1
 * alpha-3, which is what goes on the wire and into the i18n namespace.
 */

/**
 * Sovereign states, pickable by a player. 44 entries.
 *
 * The micro-states are included even though several are only a few pixels
 * across at kiosk size, because the corner list is what makes them reachable.
 */
export const SOVEREIGN: Record<string, string> = {
  gALB: 'ALB',
  gAND: 'AND',
  gAUT: 'AUT',
  gBEL: 'BEL',
  gBGR: 'BGR',
  gBIH: 'BIH',
  gBLR: 'BLR',
  gCHE: 'CHE',
  gCYP: 'CYP',
  gCZE: 'CZE',
  gDEU: 'DEU',
  gDNK: 'DNK',
  gESP: 'ESP',
  gEST: 'EST',
  gFI1: 'FIN',
  gFR1: 'FRA',
  gGBR: 'GBR',
  gGRC: 'GRC',
  gHRV: 'HRV',
  gHUN: 'HUN',
  gIRL: 'IRL',
  gISL: 'ISL',
  gITA: 'ITA',
  gLIE: 'LIE',
  gLTU: 'LTU',
  gLUX: 'LUX',
  gLVA: 'LVA',
  gMCO: 'MCO',
  gMDA: 'MDA',
  gMKD: 'MKD',
  gMLT: 'MLT',
  gMNE: 'MNE',
  gNLD: 'NLD',
  gNOR: 'NOR',
  gPOL: 'POL',
  gPRT: 'PRT',
  gROU: 'ROU',
  gSMR: 'SMR',
  gSRB: 'SRB',
  gSVK: 'SVK',
  gSVN: 'SVN',
  gSWE: 'SWE',
  gUKR: 'UKR',
  gVAT: 'VAT',
}

/**
 * Drawn as part of the landmass but never pickable. 7 entries.
 *
 * Five are dependencies rather than countries, and listing Jersey or the
 * Faroes as a peer of France would misdescribe them. Two are territory whose
 * status is disputed, and a booth game is no place to assert a position on
 * either, so they are painted as land and left unselectable.
 */
export const DRAWN_ONLY: Record<string, string> = {
  gFRO: 'FRO',
  gGGY: 'GGY',
  gGIB: 'GIB',
  gIMN: 'IMN',
  gJEY: 'JEY',
  gCYN: 'CYN',
  gRKS: 'RKS',
}

/** Every drawn path key, pickable or not. */
export const ALL_PATH_KEYS: readonly string[] = [
  ...Object.keys(SOVEREIGN),
  ...Object.keys(DRAWN_ONLY),
]
