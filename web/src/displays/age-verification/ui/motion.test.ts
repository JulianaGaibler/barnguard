import { describe, expect, it } from 'vitest'
import {
  EDGE_LOOP,
  ENDING_POSE,
  cornerSize,
  edgeSize,
  spotSize,
  MOTION,
  OVERSHOOT,
  SPLASH_POSE,
  spotCenter,
  edgePoint,
  flightPoint,
  lerp,
  loopDelta,
  reachable,
  slideOffset,
  staggered,
  stepPose,
  wrapEdge,
} from './motion'

describe('flightPoint', () => {
  const from = { x: 1100, y: 700 }
  const to = { x: 300, y: 80 }

  it('starts and ends where it is told', () => {
    expect(flightPoint(from, to, 0)).toEqual(from)
    expect(flightPoint(from, to, 1)).toEqual(to)
  })

  it('leaves straight up and arrives along the row', () => {
    const early = flightPoint(from, to, 0.05)
    const late = flightPoint(from, to, 0.95)
    // Early on it climbs and barely moves sideways.
    expect(from.y - early.y).toBeGreaterThan((from.x - early.x) * 4)
    // Late it is already at the row's height and moves along it.
    expect(late.y - to.y).toBeLessThan(late.x - to.x)
  })

  it('leaves straight across and arrives straight up when it goes across first', () => {
    const start = { x: 100, y: 700 }
    const end = { x: 500, y: 80 }
    const early = flightPoint(start, end, 0.05, 'across-first')
    const late = flightPoint(start, end, 0.95, 'across-first')
    // Early on it moves across and barely climbs.
    expect(early.x - start.x).toBeGreaterThan((start.y - early.y) * 4)
    // Late it is already over the target and climbs to it.
    expect(end.x - late.x).toBeLessThan(late.y - end.y)
    expect(flightPoint(start, end, 0, 'across-first')).toEqual(start)
    expect(flightPoint(start, end, 1, 'across-first')).toEqual(end)
  })

  it('never leaves the box between the two points', () => {
    for (let t = 0; t <= 1; t += 0.05) {
      const p = flightPoint(from, to, t)
      expect(p.x).toBeGreaterThanOrEqual(to.x - 1e-9)
      expect(p.x).toBeLessThanOrEqual(from.x + 1e-9)
      expect(p.y).toBeGreaterThanOrEqual(to.y - 1e-9)
      expect(p.y).toBeLessThanOrEqual(from.y + 1e-9)
    }
  })

  it('moves steadily toward the end', () => {
    let last = Infinity
    for (let t = 0; t <= 1; t += 0.1) {
      const p = flightPoint(from, to, t)
      const distance = Math.hypot(p.x - to.x, p.y - to.y)
      expect(distance).toBeLessThanOrEqual(last + 1e-9)
      last = distance
    }
  })
})

describe('staggered', () => {
  it('starts every part at the same value when there is only one', () => {
    expect(staggered(0.4, 0, 1)).toBe(0.4)
  })

  it('has the first part leading and the last part trailing', () => {
    expect(staggered(0.5, 0, 4)).toBeGreaterThan(staggered(0.5, 3, 4))
  })

  it('has every part start at 0 and finish at 1', () => {
    for (let i = 0; i < 5; i++) {
      expect(staggered(0, i, 5)).toBe(0)
      expect(staggered(1, i, 5)).toBe(1)
    }
  })

  it('spreads the start of the parts evenly', () => {
    const start = (i: number) => {
      let p = 0
      while (staggered(p, i, 4) === 0 && p < 1) p += 0.001
      return p
    }
    const gap1 = start(1) - start(0)
    const gap2 = start(2) - start(1)
    expect(gap1).toBeCloseTo(gap2, 2)
    expect(start(3)).toBeCloseTo(MOTION.spread, 2)
  })
})

describe('slideOffset', () => {
  it('is zero once in place and a full distance when hidden', () => {
    expect(slideOffset(1, 1, 100)).toBe(0)
    expect(slideOffset(1, 0, 100)).toBe(100)
    expect(slideOffset(-1, 0, 100)).toBe(-100)
  })

  it('is half the distance halfway', () => {
    expect(slideOffset(1, 0.5, 100)).toBe(50)
  })
})

describe('the edge loop', () => {
  it('wraps into 0..4', () => {
    expect(wrapEdge(4.5)).toBeCloseTo(0.5)
    expect(wrapEdge(-0.5)).toBeCloseTo(3.5)
    expect(wrapEdge(8)).toBe(0)
  })

  it('takes the short way round', () => {
    expect(loopDelta(3.5, 0.5)).toBeCloseTo(1)
    expect(loopDelta(0.5, 3.5)).toBeCloseTo(-1)
    expect(loopDelta(1, 2)).toBe(1)
    expect(Math.abs(loopDelta(0, 2))).toBe(2)
  })

  it('puts whole numbers on the corners of the area', () => {
    expect(edgePoint(0, 200, 100)).toEqual({ x: 0, y: 0 })
    expect(edgePoint(1, 200, 100)).toEqual({ x: 200, y: 0 })
    expect(edgePoint(2, 200, 100)).toEqual({ x: 200, y: 100 })
    expect(edgePoint(3, 200, 100)).toEqual({ x: 0, y: 100 })
  })

  it('goes clockwise along the edges', () => {
    expect(edgePoint(0.5, 200, 100)).toEqual({ x: 100, y: 0 })
    expect(edgePoint(1.5, 200, 100)).toEqual({ x: 200, y: 50 })
    expect(edgePoint(2.5, 200, 100)).toEqual({ x: 100, y: 100 })
    expect(edgePoint(3.5, 200, 100)).toEqual({ x: 0, y: 50 })
  })

  it('never crosses the middle of the area', () => {
    for (let u = 0; u < EDGE_LOOP; u += 0.05) {
      const p = edgePoint(u, 1920, 1080)
      const onEdge = p.x === 0 || p.x === 1920 || p.y === 0 || p.y === 1080
      expect(onEdge).toBe(true)
    }
  })
})

describe('stepPose', () => {
  it('is the same for the same step, so going back reproduces it', () => {
    for (let step = 0; step < 12; step++) {
      expect(stepPose(step, false)).toEqual(stepPose(step, false))
    }
  })

  it('differs from one step to the next', () => {
    for (let step = 0; step < 12; step++) {
      expect(stepPose(step, false).spots[0].u).not.toBe(
        stepPose(step + 1, false).spots[0].u,
      )
    }
  })

  it('keeps the spots on the loop and at a sensible size', () => {
    for (let step = 0; step < 60; step++) {
      for (const spot of stepPose(step, true).spots) {
        expect(spot.u).toBeGreaterThanOrEqual(0)
        expect(spot.u).toBeLessThan(EDGE_LOOP)
        expect(spot.radius).toBeGreaterThan(250)
        expect(spot.radius).toBeLessThan(600)
      }
    }
  })

  it('lights the accent spot for a moment only', () => {
    expect(stepPose(3, true).accent.strength).toBe(1)
    expect(stepPose(3, false).accent.strength).toBe(0)
    // A moment changes nothing else, so Back from it lands on the same spots.
    expect(stepPose(3, true).spots).toEqual(stepPose(3, false).spots)
  })

  it('keeps its two dark spots apart', () => {
    for (let step = 0; step < 30; step++) {
      const [a, b] = stepPose(step, false).spots
      expect(Math.abs(loopDelta(a.u, b.u))).toBeGreaterThan(1)
    }
  })
})

describe('reachable', () => {
  it('moves each spot the short way, even across the wrap', () => {
    const from = stepPose(0, false)
    const to = {
      ...from,
      spots: [
        { ...from.spots[0], u: wrapEdge(from.spots[0].u + 3.8) },
        from.spots[1],
      ] as typeof from.spots,
    }
    const way = reachable(from, to)
    // 3.8 forward is 0.2 back.
    expect(way.spots[0].u).toBeCloseTo(from.spots[0].u - 0.2)
  })

  it('keeps the target size and strength', () => {
    const way = reachable(SPLASH_POSE, ENDING_POSE)
    expect(way.spots[0].radius).toBe(ENDING_POSE.spots[0].radius)
    expect(way.accent.strength).toBe(ENDING_POSE.accent.strength)
  })
})

describe('lerp', () => {
  it('blends two numbers', () => {
    expect(lerp(10, 20, 0)).toBe(10)
    expect(lerp(10, 20, 0.25)).toBe(12.5)
    expect(lerp(10, 20, 1)).toBe(20)
  })
})

describe('spotCenter', () => {
  it('sits past the corner on both axes, as the splash spots always did', () => {
    expect(spotCenter(1, 1920, 1080)).toEqual({
      x: 1920 + OVERSHOOT,
      y: -OVERSHOOT,
    })
    expect(spotCenter(3, 1920, 1080)).toEqual({
      x: -OVERSHOOT,
      y: 1080 + OVERSHOOT,
    })
  })

  it('sits past a side only perpendicular to it, in the middle of the side', () => {
    expect(spotCenter(0.5, 1920, 1080)).toEqual({ x: 960, y: -OVERSHOOT })
    expect(spotCenter(1.5, 1920, 1080)).toEqual({ x: 1920 + OVERSHOOT, y: 540 })
    expect(spotCenter(2.5, 1920, 1080)).toEqual({ x: 960, y: 1080 + OVERSHOOT })
    expect(spotCenter(3.5, 1920, 1080)).toEqual({ x: -OVERSHOOT, y: 540 })
  })

  it('moves smoothly all the way round, with no jump', () => {
    let last = spotCenter(0, 1920, 1080)
    for (let u = 0.01; u <= 4.0001; u += 0.01) {
      const here = spotCenter(u, 1920, 1080)
      // A hundredth of the loop is about 60 pixels of edge, plus the push.
      expect(Math.hypot(here.x - last.x, here.y - last.y)).toBeLessThan(75)
      last = here
    }
  })

  it('is always outside or on the area', () => {
    for (let u = 0; u < 4; u += 0.05) {
      const p = spotCenter(u, 1600, 900)
      const outside = p.x <= 0 || p.x >= 1600 || p.y <= 0 || p.y >= 900
      expect(outside).toBe(true)
    }
  })
})

describe('edgeSize', () => {
  it('is full at a corner and smallest halfway along a side', () => {
    for (const corner of [0, 1, 2, 3]) expect(edgeSize(corner)).toBe(1)
    for (const middle of [0.5, 1.5, 2.5, 3.5]) {
      expect(edgeSize(middle)).toBeCloseTo(0.28)
    }
  })

  it('is the same either side of a corner, and wraps', () => {
    expect(edgeSize(0.9)).toBeCloseTo(edgeSize(1.1))
    expect(edgeSize(3.9)).toBeCloseTo(edgeSize(0.1))
    expect(edgeSize(4.3)).toBeCloseTo(edgeSize(0.3))
  })

  it('changes smoothly and never leaves its range', () => {
    let last = edgeSize(0)
    for (let u = 0.01; u <= 4; u += 0.01) {
      const here = edgeSize(u)
      expect(here).toBeGreaterThanOrEqual(0.28 - 1e-9)
      expect(here).toBeLessThanOrEqual(1 + 1e-9)
      expect(Math.abs(here - last)).toBeLessThan(0.06)
      last = here
    }
  })

  it('keeps a mid-side spot small enough to stay off the text', () => {
    // The text starts 128 px in, and the biggest radius is under 560.
    expect(560 * edgeSize(0.5)).toBeLessThan(200)
  })
})

describe('stepPose settles near the corners', () => {
  it('puts every spot within the jitter of a corner', () => {
    for (let step = 0; step < 40; step++) {
      const pose = stepPose(step, true)
      for (const spot of [...pose.spots, pose.accent]) {
        const away = Math.abs(spot.u - Math.round(spot.u))
        expect(Math.min(away, EDGE_LOOP - away)).toBeLessThanOrEqual(0.111)
      }
    }
  })

  it('sways to the other side on each step without travelling far', () => {
    for (let step = 0; step < 10; step++) {
      for (const spot of [0, 1] as const) {
        const a = stepPose(step, false).spots[spot].u
        const b = stepPose(step + 1, false).spots[spot].u
        const moved = loopDelta(a, b)
        expect(Math.abs(moved)).toBeGreaterThan(0.05)
        expect(Math.abs(moved)).toBeLessThan(0.25)
        expect(stepPose(step + 1, false).spots[spot].radius).not.toBeCloseTo(
          stepPose(step, false).spots[spot].radius,
          -1,
        )
      }
    }
  })
})

describe('spotSize', () => {
  it('leaves the empty top right alone and holds back the corners with controls', () => {
    expect(cornerSize(1)).toBe(1)
    expect(cornerSize(3)).toBe(1)
    expect(cornerSize(0)).toBeLessThan(1)
    expect(cornerSize(2)).toBeLessThan(1)
  })

  it('blends between corners and wraps', () => {
    expect(cornerSize(0.5)).toBeCloseTo((cornerSize(0) + cornerSize(1)) / 2)
    expect(cornerSize(4)).toBeCloseTo(cornerSize(0))
  })

  it('keeps the splash spots exactly as they were', () => {
    expect(spotSize(1)).toBe(1)
    expect(spotSize(3)).toBe(1)
  })

  it('keeps spots that settle by the controls clear of them', () => {
    // The nearest control is about 250 px from the top left and bottom right
    // corner, and a spot's dots reach about two thirds of its radius.
    for (let step = 0; step < 40; step++) {
      for (const spot of stepPose(step, true).spots) {
        const corner = Math.round(spot.u) % 4
        if (corner === 0 || corner === 2) {
          const reach = spot.radius * spotSize(spot.u) * (2 / 3)
          expect(reach - OVERSHOOT * 1.4).toBeLessThan(250)
        }
      }
    }
  })
})
