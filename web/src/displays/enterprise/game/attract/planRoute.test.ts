import { describe, expect, it } from 'vitest'
import { planRoute, type RouteInput } from './planRoute'

const INPUT: RouteInput = {
  from: { x: 0, y: 0 },
  apex: { x: 400, y: 200 },
  axisRad: Math.PI,
  coneRadius: 60,
  spacing: 10,
}

/** A fixed sequence, so a test reads the same numbers every run. */
function sequence(...values: number[]): () => number {
  let i = 0
  return () => values[i++ % values.length]
}

describe('planRoute', () => {
  it('ends on the apex when it does not fumble', () => {
    const route = planRoute(INPUT, sequence(0.7, 0.4), { fumble: false })
    const last = route[route.length - 1]
    expect(last.x).toBeCloseTo(INPUT.apex.x, 6)
    expect(last.y).toBeCloseTo(INPUT.apex.y, 6)
  })

  it('turns in from outside the cone mouth before the apex', () => {
    const route = planRoute(INPUT, sequence(0.7, 0.4), { fumble: false })
    const entry = {
      x: INPUT.apex.x + Math.cos(INPUT.axisRad) * INPUT.coneRadius * 1.1,
      y: INPUT.apex.y + Math.sin(INPUT.axisRad) * INPUT.coneRadius * 1.1,
    }
    const nearest = Math.min(
      ...route.map((p) => Math.hypot(p.x - entry.x, p.y - entry.y)),
    )
    expect(nearest).toBeLessThan(1e-6)
  })

  it('starts close to the packet', () => {
    const route = planRoute(INPUT, sequence(0.7, 0.4), { fumble: false })
    expect(
      Math.hypot(route[0].x - INPUT.from.x, route[0].y - INPUT.from.y),
    ).toBeLessThanOrEqual(INPUT.spacing * 1.5)
  })

  it('keeps every step within the spacing', () => {
    const route = planRoute(INPUT, sequence(0.2, 0.9), { fumble: false })
    let prev = INPUT.from
    for (const p of route) {
      expect(Math.hypot(p.x - prev.x, p.y - prev.y)).toBeLessThanOrEqual(
        INPUT.spacing + 1e-6,
      )
      prev = p
    }
  })

  it('bows to the side the first random number picks', () => {
    const left = planRoute(INPUT, sequence(0.1, 0.5), { fumble: false })
    const right = planRoute(INPUT, sequence(0.9, 0.5), { fumble: false })
    const mid = (r: typeof left) => r[Math.floor(r.length / 4)]
    // The chord runs from (0,0) toward the entry, and the two routes bow
    // either side of it.
    expect(mid(left).y).not.toBeCloseTo(mid(right).y, 1)
  })

  it('stops short of the apex when it fumbles', () => {
    const full = planRoute(INPUT, sequence(0.7, 0.4, 0.5), { fumble: false })
    const fumbled = planRoute(INPUT, sequence(0.7, 0.4, 0.5), { fumble: true })
    expect(fumbled.length).toBeLessThan(full.length)
    expect(fumbled.length).toBeGreaterThanOrEqual(full.length * 0.4)
    const last = fumbled[fumbled.length - 1]
    expect(
      Math.hypot(last.x - INPUT.apex.x, last.y - INPUT.apex.y),
    ).toBeGreaterThan(INPUT.coneRadius)
  })

  it('handles a packet already on the entry point', () => {
    const entry = {
      x: INPUT.apex.x + Math.cos(INPUT.axisRad) * INPUT.coneRadius * 1.1,
      y: INPUT.apex.y + Math.sin(INPUT.axisRad) * INPUT.coneRadius * 1.1,
    }
    const route = planRoute({ ...INPUT, from: entry }, sequence(0.5), {
      fumble: false,
    })
    const last = route[route.length - 1]
    expect(last.x).toBeCloseTo(INPUT.apex.x, 6)
    expect(
      route.every((p) => Number.isFinite(p.x) && Number.isFinite(p.y)),
    ).toBe(true)
  })
})
