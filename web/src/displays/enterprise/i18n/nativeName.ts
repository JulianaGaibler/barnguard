/**
 * The second line on a region's card: its name in the language it is written in
 * at home, shown beneath the name in the display language.
 */

import { EU_REGION_META } from '../game/maps/eu/regionMeta'
import { de } from './de'

/**
 * `regionId`'s name in its own language, or `null` when it matches `main` and
 * would only repeat it: Germany reads "Deutschland" alone on a German card, and
 * "Germany" over "Deutschland" on an English one.
 *
 * A Europe country's name comes from the browser's own region data in the
 * language the country writes it in. A German state's comes from the German
 * messages. A region with neither returns `null`.
 */
export function nativeName(
  mapId: string,
  regionId: string,
  main: string,
): string | null {
  const name = ownName(mapId, regionId)
  return name === null || name === main ? null : name
}

function ownName(mapId: string, regionId: string): string | null {
  if (mapId === 'eu') {
    const meta = EU_REGION_META[regionId]
    if (!meta) return null
    try {
      return (
        new Intl.DisplayNames([meta.lang], { type: 'region' }).of(meta.iso2) ??
        null
      )
    } catch {
      return null
    }
  }
  if (mapId === 'de') {
    const states = de.states as Record<string, string>
    return states[regionId] ?? null
  }
  return null
}
