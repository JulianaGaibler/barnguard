import { describe, expect, it } from 'vitest'
import type { Vec2 } from 'stargazer'
import {
  isFairer,
  minSeparation,
  predictAlongTrail,
  predictLine,
  type SpawnCandidate,
  type TrailPoints,
} from './spawnSafety'

const CLOCK = { horizonSec: 6, stepSec: 0.1 }
const ANYWHERE = (): boolean => true
const REQUIRED = 46
const EAST = 0
const SOUTH = Math.PI / 2

function trailOf(...points: Vec2[]): TrailPoints {
  return {
    pointCount: points.length,
    pointAt(index, out) {
      out.x = points[index].x
      out.y = points[index].y
      return out
    },
  }
}

function at(track: { xy: Float32Array }, step: number): Vec2 {
  return { x: track.xy[step * 2], y: track.xy[step * 2 + 1] }
}

describe('minSeparation', () => {
  it('rejects two lines that cross at the same moment', () => {
    const candidate = predictLine({ x: 0, y: 0 }, EAST, 75, 0, ANYWHERE, CLOCK)
    const other = predictLine(
      { x: 300, y: -300 },
      SOUTH,
      75,
      0,
      ANYWHERE,
      CLOCK,
    )
    expect(minSeparation(candidate, [other])).toBeLessThan(REQUIRED)
  })

  it('accepts the same lines when one reaches the crossing later', () => {
    const candidate = predictLine({ x: 0, y: 0 }, EAST, 75, 0, ANYWHERE, CLOCK)
    const other = predictLine(
      { x: 300, y: -600 },
      SOUTH,
      75,
      0,
      ANYWHERE,
      CLOCK,
    )
    expect(minSeparation(candidate, [other])).toBeGreaterThan(REQUIRED)
  })

  it('rejects a fast packet spawned behind a slow one on its line', () => {
    const slow = predictLine({ x: 100, y: 0 }, EAST, 30, 0, ANYWHERE, CLOCK)
    const fast = predictLine({ x: 0, y: 0 }, EAST, 75, 1.5, ANYWHERE, CLOCK)
    expect(minSeparation(fast, [slow])).toBeLessThan(REQUIRED)
  })

  it('accepts parallel lanes', () => {
    const a = predictLine({ x: 0, y: 0 }, EAST, 75, 0, ANYWHERE, CLOCK)
    const b = predictLine({ x: 0, y: 100 }, EAST, 75, 0, ANYWHERE, CLOCK)
    expect(minSeparation(a, [b])).toBeCloseTo(100)
  })

  it('rejects a packet passing the spawn point while the spawn grows', () => {
    const growing = predictLine({ x: 0, y: 0 }, SOUTH, 75, 1.5, ANYWHERE, CLOCK)
    const passing = predictLine({ x: -75, y: 0 }, EAST, 75, 0, ANYWHERE, CLOCK)
    expect(minSeparation(growing, [passing])).toBeLessThan(REQUIRED)
  })

  it('is unbounded with nothing to compare against', () => {
    const track = predictLine({ x: 0, y: 0 }, EAST, 75, 0, ANYWHERE, CLOCK)
    expect(minSeparation(track, [])).toBe(Infinity)
  })
})

describe('predictLine', () => {
  it('ends where the path leaves the predictable area', () => {
    const track = predictLine(
      { x: 0, y: 0 },
      EAST,
      75,
      0,
      (x) => x < 150,
      CLOCK,
    )
    expect(track.steps).toBe(20)
  })
})

describe('predictAlongTrail', () => {
  it('follows the trail, not the current heading', () => {
    const track = predictAlongTrail(
      { x: 0, y: 0 },
      { x: 75, y: 0 },
      75,
      trailOf({ x: 0, y: -100 }, { x: 0, y: -200 }),
      0,
      ANYWHERE,
      CLOCK,
    )
    const two = at(track, 20)
    expect(two.x).toBeCloseTo(0)
    expect(two.y).toBeCloseTo(-150)
  })

  it('keeps the last leg once the trail runs out', () => {
    const track = predictAlongTrail(
      { x: 0, y: 0 },
      { x: 75, y: 0 },
      75,
      trailOf({ x: 0, y: -75 }),
      0,
      ANYWHERE,
      CLOCK,
    )
    const two = at(track, 20)
    expect(two.x).toBeCloseTo(0)
    expect(two.y).toBeCloseTo(-150)
  })

  it('keeps the velocity when the only point left is underfoot', () => {
    const track = predictAlongTrail(
      { x: 0, y: 0 },
      { x: 75, y: 0 },
      75,
      trailOf({ x: 0, y: 0 }),
      0,
      ANYWHERE,
      CLOCK,
    )
    expect(track.xy.some(Number.isNaN)).toBe(false)
    const one = at(track, 10)
    expect(one.x).toBeCloseTo(75)
    expect(one.y).toBeCloseTo(0)
  })
})

describe('isFairer', () => {
  function fairest(candidates: SpawnCandidate[]): SpawnCandidate {
    let best = candidates[0]
    for (const c of candidates) if (isFairer(c, best, REQUIRED)) best = c
    return best
  }

  it('picks the most separation, then the longest runway, when none are safe', () => {
    const best = fairest([
      { separation: 20, runway: 250 },
      { separation: 40, runway: 10 },
      { separation: 40, runway: 100 },
    ])
    expect(best).toEqual({ separation: 40, runway: 100 })
  })

  it('lets runway decide between safe candidates', () => {
    const best = fairest([
      { separation: 300, runway: 50 },
      { separation: 60, runway: 200 },
    ])
    expect(best).toEqual({ separation: 60, runway: 200 })
  })
})
