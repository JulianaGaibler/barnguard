/**
 * The German map: 16 states, epicenters on their real capitals, and the
 * coastline as the failure boundary.
 */

import { parseSvgPaths, type Rect, type SvgPathMap } from '@src/stargazer'
import statesSvgRaw from '@src/displays/enterprise/assets/de-states.svg?raw'
import outlineSvgRaw from '@src/displays/enterprise/assets/de-outline.svg?raw'
import citiesSvgRaw from '@src/displays/enterprise/assets/de-cities.svg?raw'
import { TUNING } from '../../data/tuning'
import { buildLandMask, mergeAllPaths } from '../geometry'
import type {
  MapDescriptor,
  MapGeometry,
  PlayAreaContext,
  RegionInfo,
} from '../types'
import { MAP_NAMESPACE } from '../namespaces'
import { PLAY_VIEW_HEIGHT } from '../playScale'
import { ADJACENCY } from './adjacency'
import { CITY_ID_TO_STATE_ID, STATE_IDS, type StateId } from './regions'

/** Wire key for this map's records and high scores. */
export const MAP_ID_DE = 'de'

/** The whole country, which is also `de-states.svg`'s viewBox. */
const FULL_VIEW: Rect = { x: 0, y: 0, width: 661, height: 888 }

/**
 * Upper- and lower-half framings share the full country width but crop to a
 * smaller vertical slice, so the pre-game card fits below without obscuring the
 * selected state. The lower half is bottom-anchored to the 888-tall map so the
 * camera never shows empty space past the coast.
 */
const UPPER_HALF: Rect = { x: 0, y: -30, width: 661, height: PLAY_VIEW_HEIGHT }
const LOWER_HALF: Rect = {
  x: 0,
  y: FULL_VIEW.height - PLAY_VIEW_HEIGHT,
  width: 661,
  height: PLAY_VIEW_HEIGHT,
}

/** Capital position per state, from the circle AABB centres in the cities SVG. */
function capitalsFrom(cities: SvgPathMap): Map<StateId, Rect> {
  const out = new Map<StateId, Rect>()
  for (const [cityId, stateId] of Object.entries(CITY_ID_TO_STATE_ID)) {
    const entry = cities.paths.get(cityId)
    if (!entry) {
      console.warn(`[map:de] de-cities.svg has no path for city "${cityId}"`)
      continue
    }
    out.set(stateId, entry.bounds)
  }
  return out
}

/** Load the German geometry and resolve every state's region record. */
export async function loadGermanyMap(): Promise<MapDescriptor> {
  const regionPaths = parseSvgPaths(statesSvgRaw, { tessellate: true })
  const outlinePaths = parseSvgPaths(outlineSvgRaw, { tessellate: true })
  const cities = parseSvgPaths(citiesSvgRaw, { tessellate: true })

  // The outline ships as mainland plus every visible island, so it has to
  // fold into one shape before it can rasterise as one country.
  const merged = mergeAllPaths(outlinePaths)
  if (!merged) throw new Error('map:de: de-outline.svg contains no <path>')
  const landMask = await buildLandMask(merged.path, outlinePaths.viewBox)

  const capitals = capitalsFrom(cities)
  const regions: RegionInfo[] = []
  for (const id of STATE_IDS) {
    const entry = regionPaths.paths.get(id)
    if (!entry) {
      console.warn(`[map:de] de-states.svg has no path for state ${id}`)
      continue
    }
    const capital = capitals.get(id)
    // Fall back to the state's own centre when the cities SVG is missing an
    // entry, so a bad asset costs a misplaced epicenter rather than a state
    // that cannot be played at all.
    const startPoint = capital
      ? { x: capital.x + capital.width / 2, y: capital.y + capital.height / 2 }
      : {
          x: entry.bounds.x + entry.bounds.width / 2,
          y: entry.bounds.y + entry.bounds.height / 2,
        }
    // `de-states.svg` already draws its enclaves (Berlin, Bremen) as even-odd
    // subpaths of the state around them, so no state paints over another.
    regions.push({
      id,
      i18nKey: id,
      selectable: true,
      startPoint,
      shape: entry,
      drawsFill: true,
    })
  }

  const geometry: MapGeometry = { landMask }

  return {
    id: MAP_ID_DE,
    i18nNamespace: MAP_NAMESPACE[MAP_ID_DE],
    geometry,
    regions,
    idleView: FULL_VIEW,
    playViewFor(region) {
      // Which half the state's own centre falls in decides the framing. The
      // two halves are hand-set rather than derived per state so the camera
      // lands on one of two known compositions instead of a different crop
      // for all sixteen.
      const centreY = region.shape.bounds.y + region.shape.bounds.height / 2
      return centreY < FULL_VIEW.height / 2 ? UPPER_HALF : LOWER_HALF
    },
    playAreaMask(_ctx: PlayAreaContext) {
      // The coastline itself. Leaving Germany is the failure, so the mask does
      // not depend on where the camera happens to be looking.
      return landMask
    },
    previewLostAtBorder: true,
    edgesAreFailLine: false,
    gridCellWorld: TUNING.wahlkreise.grid.cellSizeWorld,
    gridMask: landMask,
    adjacency: ADJACENCY,
  }
}
