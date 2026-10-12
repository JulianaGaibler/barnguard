/**
 * Ordering the selection ripple across a map's regions.
 *
 * A map with a hand-authored neighbour graph ripples through it, which reads as
 * a wave crossing real borders. A map without one ripples by distance from the
 * selected region, which looks near enough and is the reason a 44-country graph
 * does not have to be authored by hand.
 */

import type { MapDescriptor, RegionId } from './types'

/** Depth cap, sized well above any map's graph diameter. */
const MAX_DEPTH = 20

/**
 * Ripple depth per region, `origin` included at depth 0. Regions the ripple
 * never reaches are absent.
 */
export function rippleLayers(
  map: MapDescriptor,
  origin: RegionId,
): Map<RegionId, number> {
  const out = map.adjacency
    ? graphLayers(map.adjacency, origin)
    : distanceLayers(map, origin)
  out.set(origin, 0)
  return out
}

/** BFS outward from `origin`, one depth per hop. `origin` is not included. */
function graphLayers(
  adjacency: Readonly<Record<RegionId, readonly RegionId[]>>,
  origin: RegionId,
): Map<RegionId, number> {
  const out = new Map<RegionId, number>()
  const visited = new Set<RegionId>([origin])
  let frontier: RegionId[] = [origin]
  for (let depth = 1; depth <= MAX_DEPTH; depth++) {
    const next: RegionId[] = []
    for (const node of frontier) {
      for (const n of adjacency[node] ?? []) {
        if (visited.has(n)) continue
        visited.add(n)
        out.set(n, depth)
        next.push(n)
      }
    }
    if (next.length === 0) break
    frontier = next
  }
  return out
}

/**
 * Bucket regions into rings by distance from `origin`'s start point. The ring
 * width is the map's own extent over `MAX_DEPTH`, so the wave takes a similar
 * number of steps to cross any map regardless of its coordinate scale.
 */
function distanceLayers(
  map: MapDescriptor,
  origin: RegionId,
): Map<RegionId, number> {
  const out = new Map<RegionId, number>()
  const from = map.regions.find((r) => r.id === origin)
  if (!from) return out
  const extent = Math.max(map.idleView.width, map.idleView.height)
  const ringWidth = extent / MAX_DEPTH
  for (const region of map.regions) {
    if (region.id === origin) continue
    const dx = region.startPoint.x - from.startPoint.x
    const dy = region.startPoint.y - from.startPoint.y
    const depth = Math.round(Math.hypot(dx, dy) / ringWidth)
    out.set(region.id, Math.max(1, Math.min(MAX_DEPTH, depth)))
  }
  return out
}
