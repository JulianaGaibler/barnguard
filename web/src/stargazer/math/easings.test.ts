import { describe, expect, it } from 'vitest'
import { cubicBezier, linear } from './easings'

describe('cubicBezier', () => {
  it('returns linear for diagonal control points', () => {
    expect(cubicBezier(0.25, 0.25, 0.75, 0.75)).toBe(linear)
  })

  it('matches CSS reference values', () => {
    const ease = cubicBezier(0.25, 0.1, 0.25, 1)
    expect(ease(0)).toBe(0)
    expect(ease(1)).toBe(1)
    expect(ease(0.5)).toBeCloseTo(0.8024, 3)
    expect(cubicBezier(0.42, 0, 0.58, 1)(0.5)).toBeCloseTo(0.5, 6)
  })

  it('stays monotonic and finite on a near-flat start', () => {
    const e = cubicBezier(0, 0, 0.01, 1)
    let prev = 0
    for (let i = 1; i <= 100; i++) {
      const v = e(i / 100)
      expect(Number.isFinite(v)).toBe(true)
      expect(v).toBeGreaterThanOrEqual(prev - 1e-9)
      prev = v
    }
  })

  it('overshoots when y leaves [0, 1]', () => {
    const e = cubicBezier(0.34, 1.56, 0.64, 1)
    expect(
      Math.max(...Array.from({ length: 50 }, (_, i) => e(i / 50))),
    ).toBeGreaterThan(1)
  })
})
