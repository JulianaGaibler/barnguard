import { describe, expect, it } from 'vitest'
import { computeLayout, type LayoutResult } from './layout'

describe('computeLayout', () => {
  it('scales each fit mode as specified', () => {
    // A 100x50 content in a 200x200 box.
    expect(computeLayout(100, 50, 200, 200, 'contain', 0, 0)).toEqual({
      scaleX: 2,
      scaleY: 2,
      x: 0,
      y: 0,
    })
    expect(computeLayout(100, 50, 200, 200, 'cover', 0, 0)).toMatchObject({
      scaleX: 4,
      scaleY: 4,
    })
    expect(computeLayout(100, 50, 200, 200, 'fill', 0, 0)).toMatchObject({
      scaleX: 2,
      scaleY: 4,
    })
    expect(computeLayout(100, 50, 300, 200, 'fit-width', 0, 0)).toMatchObject({
      scaleX: 3,
      scaleY: 3,
    })
    expect(computeLayout(100, 50, 300, 200, 'fit-height', 0, 0)).toMatchObject({
      scaleX: 4,
      scaleY: 4,
    })
    expect(computeLayout(100, 50, 300, 200, 'none', 0, 0)).toMatchObject({
      scaleX: 1,
      scaleY: 1,
    })
  })

  it('offsets by free space times alignment, accepting names and clamping numbers', () => {
    const named = computeLayout(100, 100, 300, 200, 'contain', 'end', 'center')
    expect(named).toEqual({ scaleX: 2, scaleY: 2, x: 100, y: 0 })
    const centered = computeLayout(100, 100, 300, 200, 'contain')
    expect(centered.x).toBe(50)
    const mixed = computeLayout(100, 100, 300, 200, 'none', 0.25, 5)
    expect(mixed.x).toBe(50)
    expect(mixed.y).toBe(100)
    expect(computeLayout(100, 100, 300, 200, 'none', -1, 'start').x).toBe(0)
  })

  it('writes into the supplied object and falls back to identity for empty content', () => {
    const out: LayoutResult = { scaleX: 0, scaleY: 0, x: 0, y: 0 }
    expect(computeLayout(10, 10, 20, 20, 'fill', 0, 0, out)).toBe(out)
    expect(out.scaleX).toBe(2)
    expect(computeLayout(0, 10, 20, 20, 'fill', 0.5, 0.5, out)).toEqual({
      scaleX: 1,
      scaleY: 1,
      x: 0,
      y: 0,
    })
  })
})
