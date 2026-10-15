import { describe, expect, it } from 'vitest'
import { Transform2D } from './Transform2D'
import type { Affine2x3 } from './Affine2D'

const apply = (m: Affine2x3, x: number, y: number) => [
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
      expect(t.local[k]).toBeCloseTo(ref[k], 12)
  })

  it('composes position, rotation, skew, scale and origin like DOMMatrix', () => {
    const t = new Transform2D()
    t.x = 12
    t.y = -7
    t.rotation = 0.8
    t.skew = 0.35
    t.skewAxis = 0.6
    t.scaleX = 1.5
    t.scaleY = -0.75
    t.originX = 4
    t.originY = 9
    t.updateLocal()
    const tan = Math.tan(0.35)
    const c = Math.cos(0.6)
    const s = Math.sin(0.6)
    const ref = new DOMMatrix()
      .translate(12, -7)
      .rotate((0.8 * 180) / Math.PI)
      .multiply(
        new DOMMatrix([
          1 - c * s * tan,
          -s * s * tan,
          c * c * tan,
          1 + c * s * tan,
          0,
          0,
        ]),
      )
      .scale(1.5, -0.75)
      .translate(-4, -9)
    for (const k of ['a', 'b', 'c', 'd', 'e', 'f'] as const)
      expect(t.local[k]).toBeCloseTo(ref[k], 12)
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
