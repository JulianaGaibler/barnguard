/**
 * Resolving a region's display name when the region id is an open string.
 *
 * Each map owns its own namespace of names (`states` for the German map,
 * `countries` for Europe), and a region id is only meaningful inside its own
 * map, so the lookup cannot be typed as an index into one record. This is the
 * single place that cast lives.
 */

import type { EnterpriseMessages } from './types'

/** Namespaces a map may name its regions under. */
export type RegionNamespace = 'states' | 'countries'

/**
 * The name for `i18nKey` under `namespace`, or the key itself when the
 * namespace has no entry for it. Falling back to the key keeps an unnamed
 * region selectable and legible (a reader sees `FRA`) rather than rendering
 * `undefined` across the card, the label and the attendant panel.
 */
export function regionName(
  messages: EnterpriseMessages,
  namespace: RegionNamespace,
  i18nKey: string,
): string {
  // `countries` only exists once the Europe map ships its names, so the
  // namespace is read off an index signature rather than a known key.
  const table = (messages as unknown as Record<string, unknown>)[namespace] as
    Record<string, string> | undefined
  return table?.[i18nKey] ?? i18nKey
}
