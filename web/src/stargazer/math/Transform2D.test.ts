import { describe, expect, it } from 'vitest'
import { Transform2D } from './Transform2D'

const apply = (m: DOMMatrix, x: number, y: number) => [
  m.a * x + m.c * y + m.e,
  m.b * x + m.d * y + m.f,
]

describe('Transform2D skew', () => {
  it('leaves the matrix untouched at skew 0', () => {
    const t = new Transform2D()
    t.x = 10
    t.rotation = 0.3
    t.scaleX = 2
    t.updateLocal()
    const ref = new DOMMatrix()
      .translate(10, 0)
      .rotate((0.3 * 180) / Math.PI)
      .scale(2, 1)
    for (const k of ['a', 'b', 'c', 'd', 'e', 'f'] as const)
      expect(t.local[k]).toBe(ref[k])
  })

  it('shears x by tan(skew) * y on the default axis', () => {
    const t = new Transform2D()
    t.skew = Math.PI / 4
    t.updateLocal()
    const [x, y] = apply(t.local, 0, 10)
    expect(x).toBeCloseTo(10, 9)
    expect(y).toBeCloseTo(10, 9)
  })

  it('shears along the axis direction and keeps the axis line fixed', () => {
    const t = new Transform2D()
    t.skew = Math.PI / 4
    t.skewAxis = Math.PI / 2
    t.updateLocal()
    const [x, y] = apply(t.local, 0, 5)
    expect(x).toBeCloseTo(0, 9)
    expect(y).toBeCloseTo(5, 9)
    const [x2, y2] = apply(t.local, 5, 0)
    expect(x2).toBeCloseTo(5, 9)
    expect(y2).toBeCloseTo(-5, 9)
  })
})
