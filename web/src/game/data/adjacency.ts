import type { StateId } from './states'

/**
 * Hand-authored neighbor graph for the German states. Used by
 * `ShockwaveBehaviour` to propagate the game-over pulse from the selected state
 * outward in BFS order.
 *
 * Every entry is symmetric, if `A` lists `B`, `B` lists `A`. Verified by the
 * `adjacency.symmetry` Vitest.
 *
 * Berlin (BE) is fully surrounded by Brandenburg (BB); Bremen (HB) sits inside
 * Niedersachsen (NI); Saarland (SL) touches only Rheinland-Pfalz (RP), a couple
 * of degenerate cases worth double-checking against a real map when tweaking.
 */
export const ADJACENCY: Record<StateId, readonly StateId[]> = {
  BW: ['BY', 'HE', 'RP'],
  BY: ['BW', 'HE', 'TH', 'SN'],
  BE: ['BB'],
  // BB ↔ NI would be a technically-real border but it's very short. Kept
  // out of the ripple graph so the wave routes through the more visually
  // legible BB → ST → NI path instead.
  BB: ['BE', 'MV', 'SN', 'ST'],
  HB: ['NI'],
  HH: ['NI', 'SH'],
  HE: ['BW', 'BY', 'NW', 'NI', 'RP', 'TH'],
  MV: ['BB', 'NI', 'SH'],
  NI: ['HB', 'HE', 'HH', 'MV', 'NW', 'ST', 'SH', 'TH'],
  NW: ['HE', 'NI', 'RP'],
  RP: ['BW', 'HE', 'NW', 'SL'],
  SL: ['RP'],
  SN: ['BB', 'BY', 'ST', 'TH'],
  ST: ['BB', 'NI', 'SN', 'TH'],
  SH: ['HH', 'MV', 'NI'],
  TH: ['BY', 'HE', 'NI', 'SN', 'ST'],
}

/**
 * BFS distance in the adjacency graph, capped at `maxDepth`. Returns `-1` if
 * `to` isn't reachable within the cap or if `from === to` (distance 0 is
 * treated as "same state", callers filter that out).
 */
export function bfsDepth(from: StateId, to: StateId, maxDepth: number): number {
  if (from === to) return 0
  const visited = new Set<StateId>([from])
  let frontier: StateId[] = [from]
  for (let depth = 1; depth <= maxDepth; depth++) {
    const next: StateId[] = []
    for (const node of frontier) {
      for (const n of ADJACENCY[node]) {
        if (visited.has(n)) continue
        if (n === to) return depth
        visited.add(n)
        next.push(n)
      }
    }
    if (next.length === 0) return -1
    frontier = next
  }
  return -1
}

/**
 * BFS the graph outward from `origin` up to `maxDepth` layers deep. Returns a
 * map `stateId → depth (1..maxDepth)`. `origin` itself is NOT included. Used by
 * `ShockwaveBehaviour.pulse` to schedule delayed alpha pulses on concentric
 * rings of neighbors.
 */
export function bfsLayers(
  origin: StateId,
  maxDepth: number,
): Map<StateId, number> {
  const out = new Map<StateId, number>()
  const visited = new Set<StateId>([origin])
  let frontier: StateId[] = [origin]
  for (let depth = 1; depth <= maxDepth; depth++) {
    const next: StateId[] = []
    for (const node of frontier) {
      for (const n of ADJACENCY[node]) {
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
