/**
 * The European map: 51 drawn countries, 44 of them pickable, epicenters on the
 * deepest point inside each country, and the screen's left and right edges as
 * the failure boundary.
 */

import {
  deepestInteriorPoint,
  parseSvgPaths,
  type Rect,
  type SvgPathMap,
} from '@src/stargazer'
import countriesSvgRaw from '@src/displays/enterprise/assets/eu-countries.svg?raw'
import { buildLandMask, mergeAllPaths } from '../geometry'
import { MAP_NAMESPACE } from '../namespaces'
import type {
  MapDescriptor,
  MapGeometry,
  PlayAreaContext,
  RegionInfo,
} from '../types'
import { fitRegionBand, ScreenEdgeMask } from './playArea'
import { DRAWN_ONLY, SOVEREIGN } from './regions'

/** Wire key for this map's records and high scores. */
export const MAP_ID_EU = 'eu'

/**
 * Grid overlay cell size. The German map uses its own tuned value over a
 * 661x888 country, so this is scaled by the ratio of map extents to keep the
 * cells about the same size relative to the landmass.
 */
const GRID_CELL_WORLD = 46

/** Build one region record, or `null` when the artwork has no such path. */
function regionFrom(
  paths: SvgPathMap,
  pathKey: string,
  id: string,
  selectable: boolean,
): RegionInfo | null {
  const entry = paths.paths.get(pathKey)
  if (!entry) {
    console.warn(`[map:eu] eu-countries.svg has no path "${pathKey}"`)
    return null
  }
  // The deepest interior point, not the centroid: a country drawn in several
  // pieces, or with a deep concavity, puts its centroid in the sea.
  const deepest = entry.contours ? deepestInteriorPoint(entry.contours) : null
  const startPoint = deepest
    ? { x: deepest[0], y: deepest[1] }
    : {
        x: entry.bounds.x + entry.bounds.width / 2,
        y: entry.bounds.y + entry.bounds.height / 2,
      }
  return { id, i18nKey: id, selectable, startPoint, shape: entry }
}

/** Load the European geometry and resolve every country's region record. */
export async function loadEuropeMap(): Promise<MapDescriptor> {
  const regionPaths = parseSvgPaths(countriesSvgRaw, { tessellate: true })
  const viewBox = regionPaths.viewBox

  // There is no separate outline asset for Europe, so the landmass is the
  // union of the countries themselves.
  const merged = mergeAllPaths(regionPaths)
  if (!merged) throw new Error('map:eu: eu-countries.svg contains no <path>')
  const landMask = await buildLandMask(merged.path, viewBox)

  const regions: RegionInfo[] = []
  for (const [pathKey, id] of Object.entries(SOVEREIGN)) {
    const region = regionFrom(regionPaths, pathKey, id, true)
    if (region) regions.push(region)
  }
  for (const [pathKey, id] of Object.entries(DRAWN_ONLY)) {
    const region = regionFrom(regionPaths, pathKey, id, false)
    if (region) regions.push(region)
  }

  const geometry: MapGeometry = { landMask }
  const idleView: Rect = { ...viewBox }

  return {
    id: MAP_ID_EU,
    i18nNamespace: MAP_NAMESPACE[MAP_ID_EU],
    geometry,
    regions,
    idleView,
    playViewFor(region, cameraAspect) {
      return fitRegionBand(region.shape.bounds, idleView, cameraAspect)
    },
    playAreaMask(ctx: PlayAreaContext) {
      return new ScreenEdgeMask(ctx.viewport)
    },
    gridCellWorld: GRID_CELL_WORLD,
    // No neighbour graph. A 44-country graph is not worth authoring by hand,
    // so the selection ripple orders by distance instead (see `maps/ripple`).
  }
}
