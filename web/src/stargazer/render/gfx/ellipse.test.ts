import { describe, expect, it } from 'vitest'
import { ellipseDistance } from './ellipse'

/** The nearest point on the outline by dense sampling, for reference. */
function bruteForce(px: number, py: number, rx: number, ry: number): number {
  let best = Infinity
  const steps = 200000
  for (let i = 0; i < steps; i++) {
    const t = (i / steps) * Math.PI * 2
    best = Math.min(
      best,
      Math.hypot(px - rx * Math.cos(t), py - ry * Math.sin(t)),
    )
  }
  const inside = (px / rx) ** 2 + (py / ry) ** 2 < 1
  return inside ? -best : best
}

describe('ellipseDistance', () => {
  const cases: [string, number, number, number, number][] = [
    ['outside, oblique', 140, 70, 100, 40],
    ['inside, oblique', 30, 10, 100, 40],
    ['outside, steep', 20, 90, 100, 40],
    ['on the x axis outside', 130, 0, 100, 40],
    ['on the x axis inside', 50, 0, 100, 40],
    ['on the y axis outside', 0, 60, 100, 40],
    ['on the y axis inside', 0, 10, 100, 40],
    ['tall ellipse', 30, 120, 25, 150],
    ['very thin ellipse', 50, 3, 200, 2],
    ['near the center', 0.001, 0.002, 100, 40],
  ]
  for (const [name, px, py, rx, ry] of cases) {
    it(`matches dense sampling ${name}`, () => {
      const [distance, gx, gy] = ellipseDistance(px, py, rx, ry)
      expect(distance).toBeCloseTo(bruteForce(px, py, rx, ry), 2)
      expect(Math.hypot(gx, gy)).toBeCloseTo(1, 5)
      expect(Number.isNaN(gx) || Number.isNaN(gy)).toBe(false)
    })
  }

  it('is the plain circle distance when the radii are equal', () => {
    expect(ellipseDistance(30, 40, 20, 20)[0]).toBeCloseTo(30)
    expect(ellipseDistance(0, 0, 20, 20)[0]).toBeCloseTo(-20)
  })

  it('points the gradient outward from the outline, inside and out', () => {
    // Past x = a - b² / a = 84, the nearest point to a point on the major axis
    // is the axis's own end, so the gradient runs along the axis.
    const outside = ellipseDistance(120, 0, 100, 40)
    const inside = ellipseDistance(90, 0, 100, 40)
    expect(outside[1]).toBeCloseTo(1)
    expect(inside[1]).toBeCloseTo(1)
  })

  it('mirrors into every quadrant', () => {
    const [d] = ellipseDistance(140, 70, 100, 40)
    const [d2, gx, gy] = ellipseDistance(-140, -70, 100, 40)
    expect(d2).toBeCloseTo(d)
    expect(gx).toBeLessThan(0)
    expect(gy).toBeLessThan(0)
  })
})
