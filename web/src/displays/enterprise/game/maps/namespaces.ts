/**
 * Which i18n namespace each map names its regions under, available without
 * loading the map itself.
 *
 * The attendant's reprint flow resolves a region name from a persisted record,
 * with no session and no loaded map to ask, and parsing a map's artwork just to
 * read one string would be absurd. Map descriptors take their own
 * `i18nNamespace` from here so the two cannot drift.
 */

import type { RegionNamespace } from '../../i18n/regionName'

export const MAP_NAMESPACE: Record<string, RegionNamespace> = {
  de: 'states',
  eu: 'countries',
}

/**
 * The namespace for `mapId`, falling back to the German map's. A record written
 * before maps existed carries no map id, and every one of those is a German
 * round.
 */
export function namespaceForMap(mapId: string | undefined): RegionNamespace {
  return (mapId && MAP_NAMESPACE[mapId]) || 'states'
}
