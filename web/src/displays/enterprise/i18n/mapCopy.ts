/**
 * Resolving the strings that read differently per map.
 *
 * A map id reaches here from a URL parameter or a stored record, so it is not
 * guaranteed to be one the bundle has copy for. This is the single place that
 * falls back.
 */

import { DEFAULT_MAP_ID } from '../game'
import type { EnterpriseMessages, MapCopy } from './types'

/**
 * Copy for `mapId`, falling back to the default map's. A map with no copy of
 * its own reads as the German map rather than rendering blanks, which keeps a
 * mis-set parameter legible instead of silently empty.
 */
export function mapCopy(messages: EnterpriseMessages, mapId: string): MapCopy {
  const table = messages.maps as unknown as Record<string, MapCopy | undefined>
  const copy = table[mapId] ?? table[DEFAULT_MAP_ID]
  if (!copy) throw new Error(`i18n: no map copy for "${mapId}" or the default`)
  return copy
}
