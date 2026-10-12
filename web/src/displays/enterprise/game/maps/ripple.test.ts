import { describe, expect, it } from 'vitest'
import { rippleLayers } from './ripple'
import type { MapDescriptor, RegionInfo } from './types'

function region(id: string, x: number, y: number): RegionInfo {
  return {
    id,
    i18nKey: id,
    selectable: true,
    startPoint: { x, y },
    bounds: { x, y, width: 10, height: 10 },
  }
}

/** Only the fields `rippleLayers` reads. */
function fakeMap(
  regions: RegionInfo[],
  adjacency?: Record<string, readonly string[]>,
): MapDescriptor {
  return {
    regions,
    idleView: { x: 0, y: 0, width: 100, height: 100 },
    adjacency,
  } as unknown as MapDescriptor
}

describe('rippleLayers', () => {
  it('walks the neighbour graph a hop at a time when the map has one', () => {
    const map = fakeMap(
      [region('a', 0, 0), region('b', 50, 0), region('c', 99, 0)],
      { a: ['b'], b: ['a', 'c'], c: ['b'] },
    )
    const layers = rippleLayers(map, 'a')
    expect(layers.get('a')).toBe(0)
    expect(layers.get('b')).toBe(1)
    expect(layers.get('c')).toBe(2)
  })

  it('leaves regions the graph cannot reach out of the ripple', () => {
    const map = fakeMap([region('a', 0, 0), region('island', 90, 90)], {
      a: [],
      island: [],
    })
    const layers = rippleLayers(map, 'a')
    expect(layers.get('a')).toBe(0)
    expect(layers.has('island')).toBe(false)
  })

  it('orders by distance when the map has no graph', () => {
    const map = fakeMap([
      region('origin', 0, 0),
      region('near', 10, 0),
      region('far', 90, 0),
    ])
    const layers = rippleLayers(map, 'origin')
    expect(layers.get('origin')).toBe(0)
    // Every region is reached, and the nearer one ripples first.
    expect(layers.get('near')).toBeLessThan(layers.get('far')!)
    expect(layers.get('near')).toBeGreaterThan(0)
  })

  it('reaches every region without a graph, however far out', () => {
    const map = fakeMap([region('origin', 0, 0), region('corner', 100, 100)])
    const layers = rippleLayers(map, 'origin')
    expect(layers.has('corner')).toBe(true)
  })
})
