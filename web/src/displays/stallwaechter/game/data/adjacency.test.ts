import { describe, expect, it } from 'vitest'
import { ADJACENCY, bfsDepth, bfsLayers } from './adjacency'
import { STATE_IDS, type StateId } from './states'

describe('ADJACENCY', () => {
  it('has an entry for every state', () => {
    for (const id of STATE_IDS) {
      expect(ADJACENCY[id]).toBeDefined()
    }
  })

  it('is symmetric, every A→B implies B→A', () => {
    for (const a of STATE_IDS) {
      for (const b of ADJACENCY[a]) {
        expect(
          ADJACENCY[b],
          `${a} lists ${b} as neighbor but ${b} does not list ${a}`,
        ).toContain(a)
      }
    }
  })

  it('never lists a state as its own neighbor', () => {
    for (const id of STATE_IDS) {
      expect(ADJACENCY[id]).not.toContain(id)
    }
  })

  it('references only known state ids', () => {
    const known = new Set<StateId>(STATE_IDS)
    for (const id of STATE_IDS) {
      for (const n of ADJACENCY[id]) {
        expect(known.has(n)).toBe(true)
      }
    }
  })

  it('BE is fully surrounded by BB, a topological edge case worth locking in', () => {
    expect(ADJACENCY.BE).toEqual(['BB'])
    expect(ADJACENCY.BB).toContain('BE')
  })

  it('HB (Bremen) sits inside NI only', () => {
    expect(ADJACENCY.HB).toEqual(['NI'])
    expect(ADJACENCY.NI).toContain('HB')
  })

  it('SL (Saarland) touches only RP', () => {
    expect(ADJACENCY.SL).toEqual(['RP'])
    expect(ADJACENCY.RP).toContain('SL')
  })
})

describe('bfsDepth', () => {
  it('returns 0 for same-state', () => {
    expect(bfsDepth('BW', 'BW', 5)).toBe(0)
  })

  it('returns 1 for direct neighbors', () => {
    expect(bfsDepth('BE', 'BB', 3)).toBe(1)
    expect(bfsDepth('BB', 'BE', 3)).toBe(1)
  })

  it('returns 2 for two-hop neighbors (BE → BB → MV)', () => {
    expect(bfsDepth('BE', 'MV', 3)).toBe(2)
  })

  it('caps at maxDepth and returns -1 when unreachable within it', () => {
    // BE is one hop from BB; a maxDepth of 0 finds nothing (returns -1).
    // (Same-state is treated as depth 0 above.)
    expect(bfsDepth('BE', 'BB', 0)).toBe(-1)
  })
})

describe('bfsLayers', () => {
  it('never includes the origin', () => {
    const layers = bfsLayers('BE', 3)
    expect(layers.has('BE')).toBe(false)
  })

  it('assigns direct neighbors depth 1', () => {
    const layers = bfsLayers('BE', 3)
    expect(layers.get('BB')).toBe(1)
  })

  it('assigns depth 2 for two-hop states', () => {
    const layers = bfsLayers('BE', 3)
    // BE→BB→MV, BE→BB→SN etc.
    expect(layers.get('MV')).toBe(2)
    expect(layers.get('SN')).toBe(2)
  })

  it('respects the depth cap', () => {
    const layers = bfsLayers('BE', 1)
    for (const depth of layers.values()) {
      expect(depth).toBeLessThanOrEqual(1)
    }
    expect(layers.has('MV')).toBe(false) // two hops away
  })
})
