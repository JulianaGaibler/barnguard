/**
 * The maps this display can boot, resolved from the `?map=` URL parameter.
 *
 * Each entry is a dynamic import so a session only pays for the map it plays.
 * That matters here: the Europe artwork is an order of magnitude larger than
 * Germany's, and a German booth should not download it.
 */

import type { MapDescriptor } from './types'

/**
 * The map a bare `?display=enterprise` boots. Kiosks are configured with a URL
 * that predates `?map=`, so a missing parameter has to keep working.
 */
export const DEFAULT_MAP_ID = 'de'

const MAP_LOADERS: Record<string, () => Promise<MapDescriptor>> = {
  de: () => import('./de').then((m) => m.loadGermanyMap()),
}

/** Every map id this build can boot. */
export function knownMapIds(): readonly string[] {
  return Object.keys(MAP_LOADERS)
}

/**
 * Resolve the `?map=` parameter. Absent means {@link DEFAULT_MAP_ID}, but an
 * unrecognised value throws rather than falling back, matching how `main.ts`
 * treats an unknown `?display=`: a mis-configured kiosk should fail where
 * someone will notice it, not quietly run the wrong event's map.
 */
export function resolveMapId(param: string | null | undefined): string {
  if (param === null || param === undefined || param === '') {
    return DEFAULT_MAP_ID
  }
  if (!(param in MAP_LOADERS)) {
    throw new Error(
      `unknown map "${param}", expected one of ${knownMapIds().join(', ')}`,
    )
  }
  return param
}

/** Load the descriptor for `id`, which must come from {@link resolveMapId}. */
export async function loadMap(id: string): Promise<MapDescriptor> {
  const loader = MAP_LOADERS[id]
  if (!loader) {
    throw new Error(
      `unknown map "${id}", expected one of ${knownMapIds().join(', ')}`,
    )
  }
  return loader()
}

export type {
  MapDescriptor,
  MapGeometry,
  PlayAreaContext,
  RegionId,
  RegionInfo,
} from './types'
export { findRegion, selectableRegions } from './types'
export { MAP_NAMESPACE, namespaceForMap } from './namespaces'
