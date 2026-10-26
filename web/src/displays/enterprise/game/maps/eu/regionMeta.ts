/**
 * What the Europe map's regions need beyond a name: the ISO 3166-1 alpha-2 code
 * that picks a flag, and the language a country writes its own name in.
 *
 * Keyed by the region ids the map already uses (ISO 3166-1 alpha-3). Where a
 * country has several languages the national one is listed: German for
 * Switzerland, Dutch for Belgium, and Latin script for Serbia and Montenegro so
 * the name reads in the same script as the rest of the card.
 */
export interface EuRegionMeta {
  iso2: string
  /** BCP 47 tag the country's own name is written in. */
  lang: string
}

export const EU_REGION_META: Readonly<Record<string, EuRegionMeta>> = {
  ALB: { iso2: 'AL', lang: 'sq' },
  AND: { iso2: 'AD', lang: 'ca' },
  AUT: { iso2: 'AT', lang: 'de' },
  BEL: { iso2: 'BE', lang: 'nl' },
  BGR: { iso2: 'BG', lang: 'bg' },
  BIH: { iso2: 'BA', lang: 'bs' },
  BLR: { iso2: 'BY', lang: 'be' },
  CHE: { iso2: 'CH', lang: 'de' },
  CYP: { iso2: 'CY', lang: 'el' },
  CZE: { iso2: 'CZ', lang: 'cs' },
  DEU: { iso2: 'DE', lang: 'de' },
  DNK: { iso2: 'DK', lang: 'da' },
  ESP: { iso2: 'ES', lang: 'es' },
  EST: { iso2: 'EE', lang: 'et' },
  FIN: { iso2: 'FI', lang: 'fi' },
  FRA: { iso2: 'FR', lang: 'fr' },
  GBR: { iso2: 'GB', lang: 'en' },
  GRC: { iso2: 'GR', lang: 'el' },
  HRV: { iso2: 'HR', lang: 'hr' },
  HUN: { iso2: 'HU', lang: 'hu' },
  IRL: { iso2: 'IE', lang: 'ga' },
  ISL: { iso2: 'IS', lang: 'is' },
  ITA: { iso2: 'IT', lang: 'it' },
  LIE: { iso2: 'LI', lang: 'de' },
  LTU: { iso2: 'LT', lang: 'lt' },
  LUX: { iso2: 'LU', lang: 'lb' },
  LVA: { iso2: 'LV', lang: 'lv' },
  MCO: { iso2: 'MC', lang: 'fr' },
  MDA: { iso2: 'MD', lang: 'ro' },
  MKD: { iso2: 'MK', lang: 'mk' },
  MLT: { iso2: 'MT', lang: 'mt' },
  MNE: { iso2: 'ME', lang: 'sr-Latn' },
  NLD: { iso2: 'NL', lang: 'nl' },
  NOR: { iso2: 'NO', lang: 'nb' },
  POL: { iso2: 'PL', lang: 'pl' },
  PRT: { iso2: 'PT', lang: 'pt' },
  ROU: { iso2: 'RO', lang: 'ro' },
  SMR: { iso2: 'SM', lang: 'it' },
  SRB: { iso2: 'RS', lang: 'sr-Latn' },
  SVK: { iso2: 'SK', lang: 'sk' },
  SVN: { iso2: 'SI', lang: 'sl' },
  SWE: { iso2: 'SE', lang: 'sv' },
  UKR: { iso2: 'UA', lang: 'uk' },
  VAT: { iso2: 'VA', lang: 'it' },
}
