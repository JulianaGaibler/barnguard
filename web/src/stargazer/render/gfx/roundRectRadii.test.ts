import { describe, it, expect } from 'vitest'
import { resolveRadii } from './roundRectRadii'

describe('resolveRadii', () => {
  it('expands a single number to all four corners', () => {
    expect(resolveRadii(8, 100, 100)).toEqual([8, 8, 8, 8])
  })

  it('expands the CSS 1–4 shorthand', () => {
    expect(resolveRadii([8], 100, 100)).toEqual([8, 8, 8, 8])
    // [tl&br, tr&bl]
    expect(resolveRadii([8, 12], 100, 100)).toEqual([8, 12, 8, 12])
    // [tl, tr&bl, br]
    expect(resolveRadii([8, 12, 4], 100, 100)).toEqual([8, 12, 4, 12])
    // [tl, tr, br, bl]
    expect(resolveRadii([1, 2, 3, 4], 100, 100)).toEqual([1, 2, 3, 4])
  })

  it('clamps negative radii to zero', () => {
    expect(resolveRadii([-5, 10, -1, 4], 100, 100)).toEqual([0, 10, 0, 4])
  })

  it('proportionally shrinks radii that overrun a side', () => {
    // Both top corners want 60 on a 100-wide box: sum 120 > 100 → scale 100/120.
    const [tl, tr, br, bl] = resolveRadii([60, 60, 0, 0], 100, 200)
    expect(tl).toBeCloseTo(50)
    expect(tr).toBeCloseTo(50)
    expect(br).toBe(0)
    expect(bl).toBe(0)
  })

  it('clamps a single over-large radius to the half-extent (capsule)', () => {
    // radius 999 on a 40-tall, 200-wide box → limited by height/2 = 20.
    expect(resolveRadii(999, 200, 40)).toEqual([20, 20, 20, 20])
  })

  it('returns zeros for a degenerate box', () => {
    expect(resolveRadii(10, 0, 50)).toEqual([0, 0, 0, 0])
    expect(resolveRadii(10, 50, -1)).toEqual([0, 0, 0, 0])
  })
})
