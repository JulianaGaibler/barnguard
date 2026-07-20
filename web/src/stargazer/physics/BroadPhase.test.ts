import { describe, expect, it } from 'vitest'
import { Body } from './Body'
import { circleShape } from './Collider'
import { BruteForceBroadPhase, type BroadPhase } from './BroadPhase'
import { SpatialHashBroadPhase } from './SpatialHashBroadPhase'

// Small seeded LCG so the fuzz layouts are reproducible.
function lcg(seed: number): () => number {
  let s = seed >>> 0
  return () => {
    s = (s * 1664525 + 1013904223) >>> 0
    return s / 0xffffffff
  }
}

function pairSet(bp: BroadPhase): Set<string> {
  bp.update()
  const out = new Set<string>()
  bp.queryPairs((a, b) => {
    const lo = Math.min(a.id, b.id)
    const hi = Math.max(a.id, b.id)
    out.add(`${lo}:${hi}`)
  })
  return out
}

describe('SpatialHashBroadPhase vs BruteForceBroadPhase', () => {
  it('emits the same pair set across random layouts', () => {
    const rand = lcg(12345)
    for (let trial = 0; trial < 20; trial++) {
      const brute = new BruteForceBroadPhase()
      const hash = new SpatialHashBroadPhase(40)
      const n = 5 + Math.floor(rand() * 40)
      for (let i = 0; i < n; i++) {
        const b = new Body({
          position: { x: rand() * 400 - 200, y: rand() * 400 - 200 },
          colliders: [{ shape: circleShape(5 + rand() * 30) }],
        })
        brute.insert(b)
        hash.insert(b)
      }
      const a = pairSet(brute)
      const c = pairSet(hash)
      expect(c).toEqual(a)
    }
  })

  it('handles bodies larger than a cell (multi-cell coverage) without missing pairs', () => {
    const brute = new BruteForceBroadPhase()
    const hash = new SpatialHashBroadPhase(10)
    // Two big overlapping circles spanning many cells.
    const a = new Body({
      position: { x: 0, y: 0 },
      colliders: [{ shape: circleShape(50) }],
    })
    const b = new Body({
      position: { x: 30, y: 0 },
      colliders: [{ shape: circleShape(50) }],
    })
    brute.insert(a)
    brute.insert(b)
    hash.insert(a)
    hash.insert(b)
    expect(pairSet(hash)).toEqual(pairSet(brute))
  })

  it('queryRegion agrees with brute force', () => {
    const rand = lcg(999)
    const brute = new BruteForceBroadPhase()
    const hash = new SpatialHashBroadPhase(40)
    for (let i = 0; i < 30; i++) {
      const b = new Body({
        position: { x: rand() * 400 - 200, y: rand() * 400 - 200 },
        colliders: [{ shape: circleShape(10) }],
      })
      brute.insert(b)
      hash.insert(b)
    }
    brute.update()
    hash.update()
    const region = { x: -50, y: -50, width: 100, height: 100 }
    const bOut: Body[] = []
    const hOut: Body[] = []
    brute.queryRegion(region, bOut)
    hash.queryRegion(region, hOut)
    const bIds = new Set(bOut.map((x) => x.id))
    const hIds = new Set(hOut.map((x) => x.id))
    expect(hIds).toEqual(bIds)
  })

  it('queryRay returns bodies along the ray path', () => {
    const hash = new SpatialHashBroadPhase(20)
    const onPath = new Body({
      position: { x: 100, y: 0 },
      colliders: [{ shape: circleShape(10) }],
    })
    const offPath = new Body({
      position: { x: 100, y: 500 },
      colliders: [{ shape: circleShape(10) }],
    })
    hash.insert(onPath)
    hash.insert(offPath)
    hash.update()
    const out: Body[] = []
    hash.queryRay({ x: 0, y: 0 }, { x: 1, y: 0 }, 200, out)
    const ids = new Set(out.map((b) => b.id))
    expect(ids.has(onPath.id)).toBe(true)
  })
})
