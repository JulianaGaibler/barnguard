import { describe, expect, it } from 'vitest'
import { constantProp } from '../anim/props'
import type { LottieRectItem } from '../model/types'
import { PathSet, puckerBloatSet, roundCornersSet, trimSet } from './modifiers'
import { PathPool, genRect } from './shapes'

function rect(w: number, h: number, round = 0): LottieRectItem {
  return {
    kind: 'rect',
    name: 'r',
    direction: 1,
    position: constantProp([0, 0]),
    size: constantProp([w, h]),
    roundness: constantProp([round]),
  }
}

/** Total polyline length of an open or closed vertex path, lines only. */
function lineLength(set: PathSet): number {
  let len = 0
  for (let i = 0; i < set.count; i++) {
    const p = set.items[i]
    const n = p.closed ? p.count : p.count - 1
    for (let k = 0; k < n; k++) {
      const b = (k + 1) % p.count
      len += Math.hypot(
        p.v[b * 2] - p.v[k * 2],
        p.v[b * 2 + 1] - p.v[k * 2 + 1],
      )
    }
  }
  return len
}

describe('modifiers', () => {
  it('starts a rectangle at the top right and runs clockwise', () => {
    const pool = new PathPool()
    const p = genRect(pool, rect(20, 10), 0)
    expect(Array.from(p.v.slice(0, 4))).toEqual([10, -5, 10, 5])
    expect(p.closed).toBe(true)
  })

  it('trims by length from the path start', () => {
    const pool = new PathPool()
    const set = new PathSet()
    set.push(genRect(pool, rect(20, 10), 0))
    const out = new PathSet()
    // Perimeter 60. Keep the first half: 30 units.
    trimSet(set, out, pool, 0, 0.5, 0, false)
    expect(out.count).toBe(1)
    expect(out.items[0].closed).toBe(false)
    expect(lineLength(out)).toBeCloseTo(30, 4)
    // The offset shifts the kept window and wraps past the end.
    trimSet(set, out, pool, 0, 0.5, 0.75, false)
    expect(out.count).toBe(2)
    expect(lineLength(out)).toBeCloseTo(30, 4)
    // A range that is all but a hair of the path also stays closed.
    trimSet(set, out, pool, 0.0005, 1, 0, false)
    expect(out.items[0].closed).toBe(true)
    // A full range keeps the closed path untouched.
    trimSet(set, out, pool, 0, 1, 0, false)
    expect(out.items[0].closed).toBe(true)
  })

  it('measures paths separately or together', () => {
    const pool = new PathPool()
    const set = new PathSet()
    set.push(genRect(pool, rect(20, 10), 0)) // 60
    set.push(genRect(pool, rect(10, 10), 0)) // 40
    const out = new PathSet()
    trimSet(set, out, pool, 0, 0.5, 0, true)
    expect(lineLength(out)).toBeCloseTo(30 + 20, 4)
    // Together: the first half of 100 covers the first path's 50 of 60.
    trimSet(set, out, pool, 0, 0.5, 0, false)
    expect(out.count).toBe(1)
    expect(lineLength(out)).toBeCloseTo(50, 4)
  })

  it('rounds straight corners and leaves curves', () => {
    const pool = new PathPool()
    const set = new PathSet()
    set.push(genRect(pool, rect(20, 10), 0))
    const out = new PathSet()
    roundCornersSet(set, out, pool, 3)
    expect(out.items[0].count).toBe(8)
    // The arc starts 3 units along the incoming edge.
    const rounded = new PathSet()
    rounded.push(genRect(pool, rect(20, 10), 4))
    roundCornersSet(rounded, out, pool, 3)
    expect(out.items[0].count).toBe(8)
  })

  it('pulls vertices toward the center for a positive pucker', () => {
    const pool = new PathPool()
    const set = new PathSet()
    set.push(genRect(pool, rect(20, 10), 0))
    const out = new PathSet()
    puckerBloatSet(set, out, pool, 0.5)
    expect(Math.abs(out.items[0].v[0])).toBeCloseTo(5, 6)
    expect(Math.abs(out.items[0].v[1])).toBeCloseTo(2.5, 6)
  })
})
