/**
 * Which map the running session loaded, for display surfaces outside the game
 * canvas.
 *
 * The attendant panel and the printed label both need a region's name, and a
 * region id only resolves against its own map's i18n namespace. They have no
 * session reference, so the game publishes the active map here when it boots.
 */

import { writable } from 'svelte/store'
import type { RegionNamespace } from './i18n'

export interface ActiveMap {
  /** The map's wire id, e.g. `'de'`. */
  id: string
  i18nNamespace: RegionNamespace
}

/** `null` until the session has loaded a map, and after teardown. */
export const activeMap = writable<ActiveMap | null>(null)
