import { describe, expect, it } from 'vitest'
import { cssLinearGradient } from './cssGradient'

const BLACK_WHITE = [
  { offset: 0, color: '#000' },
  { offset: 1, color: '#fff' },
]

describe('cssLinearGradient', () => {
  it('runs bottom to top at 0deg', () => {
    const g = cssLinearGradient(200, 100, 0, BLACK_WHITE)
    expect(g.x0).toBeCloseTo(100)
    expect(g.y0).toBeCloseTo(100)
    expect(g.x1).toBeCloseTo(100)
    expect(g.y1).toBeCloseTo(0)
  })

  it('runs left to right at 90deg', () => {
    const g = cssLinearGradient(200, 100, 90, BLACK_WHITE)
    expect(g.x0).toBeCloseTo(0)
    expect(g.y0).toBeCloseTo(50)
    expect(g.x1).toBeCloseTo(200)
    expect(g.y1).toBeCloseTo(50)
  })

  it('spans the box corner to corner at an oblique angle', () => {
    // The CSS gradient line length is |w sin a| + |h cos a|.
    const w = 330
    const h = 330
    const a = (75 * Math.PI) / 180
    const g = cssLinearGradient(w, h, 75, BLACK_WHITE)
    const length = Math.hypot(g.x1 - g.x0, g.y1 - g.y0)
    expect(length).toBeCloseTo(
      Math.abs(w * Math.sin(a)) + Math.abs(h * Math.cos(a)),
    )
    // Centered on the box.
    expect((g.x0 + g.x1) / 2).toBeCloseTo(w / 2)
    expect((g.y0 + g.y1) / 2).toBeCloseTo(h / 2)
  })

  it('keeps stops inside [0, 1] where they are', () => {
    const g = cssLinearGradient(100, 100, 90, [
      { offset: 0, color: '#000' },
      { offset: 0.25, color: '#888' },
      { offset: 1, color: '#fff' },
    ])
    expect(g.stops.map((s) => s.offset)).toEqual([0, 0.25, 1])
  })

  it('stretches the axis to reach stops outside [0, 1]', () => {
    // At 90deg on a 100 wide box, CSS positions -50% and 150% sit at x = -50
    // and x = 150.
    const g = cssLinearGradient(100, 40, 90, [
      { offset: -0.5, color: '#000' },
      { offset: 0.5, color: '#888' },
      { offset: 1.5, color: '#fff' },
    ])
    expect(g.x0).toBeCloseTo(-50)
    expect(g.x1).toBeCloseTo(150)
    expect(g.stops.map((s) => s.offset)).toEqual([0, 0.5, 1])
    expect(g.stops.map((s) => s.color)).toEqual(['#000', '#888', '#fff'])
  })
})
