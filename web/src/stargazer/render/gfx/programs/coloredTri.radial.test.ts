import { describe, expect, it } from 'vitest'
import { radialProjection } from './coloredTri'

type Affine = {
  a: number
  b: number
  c: number
  d: number
  e: number
  f: number
}

/** Where a local point of the gradient lands in its unit-circle space. */
function project(
  t: Affine,
  g: Parameters<typeof radialProjection>[1],
  x: number,
  y: number,
) {
  const m = radialProjection(t, g)
  const px = t.a * x + t.c * y + t.e
  const py = t.b * x + t.d * y + t.f
  return {
    x: m.xx * px + m.xy * py + m.offsetX,
    y: m.yx * px + m.yy * py + m.offsetY,
    center: { x: m.ex, y: m.ey },
  }
}

const angle = 0.7
const transforms: Record<string, Affine> = {
  identity: { a: 1, b: 0, c: 0, d: 1, e: 0, f: 0 },
  'rotated and unevenly scaled': {
    a: 3 * Math.cos(angle),
    b: 3 * Math.sin(angle),
    c: -0.5 * Math.sin(angle),
    d: 0.5 * Math.cos(angle),
    e: 40,
    f: -12,
  },
}

describe('radialProjection', () => {
  for (const [name, t] of Object.entries(transforms)) {
    it(`puts the circle's outline at radius 1 from the center when ${name}`, () => {
      const g = { cx: 10, cy: 20, r: 30 }
      for (let i = 0; i < 8; i++) {
        const theta = (i / 8) * Math.PI * 2
        const q = project(
          t,
          g,
          10 + 30 * Math.cos(theta),
          20 + 30 * Math.sin(theta),
        )
        expect(Math.hypot(q.x - q.center.x, q.y - q.center.y)).toBeCloseTo(1, 9)
      }
    })

    it(`puts the focal point at the origin when ${name}`, () => {
      const q = project(t, { cx: 10, cy: 20, r: 30, fx: 15, fy: 18 }, 15, 18)
      expect(q.x).toBeCloseTo(0, 9)
      expect(q.y).toBeCloseTo(0, 9)
    })
  }

  it('pulls a focal point outside the circle back inside it', () => {
    const q = project(
      transforms.identity,
      { cx: 0, cy: 0, r: 10, fx: 50, fy: 0 },
      0,
      0,
    )
    expect(Math.hypot(q.center.x, q.center.y)).toBeCloseTo(0.99, 9)
  })
})
