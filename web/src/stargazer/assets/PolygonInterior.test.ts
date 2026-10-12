import { describe, it, expect } from 'vitest'
import { deepestInteriorPoint } from './PolygonInterior'

const c = (...pts: number[]): Float32Array => new Float32Array(pts)

/** Even-odd containment, mirroring the module's own rule, for assertions. */
function inside(x: number, y: number, contours: Float32Array[]): boolean {
  let hit = false
  for (const poly of contours) {
    const n = poly.length / 2
    for (let i = 0, j = n - 1; i < n; j = i++) {
      const xi = poly[i * 2]
      const yi = poly[i * 2 + 1]
      const xj = poly[j * 2]
      const yj = poly[j * 2 + 1]
      if (yi > y !== yj > y && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) {
        hit = !hit
      }
    }
  }
  return hit
}

describe('deepestInteriorPoint', () => {
  it('lands on the centre of a square', () => {
    const pt = deepestInteriorPoint([c(0, 0, 10, 0, 10, 10, 0, 10)])!
    expect(pt[0]).toBeCloseTo(5, 1)
    expect(pt[1]).toBeCloseTo(5, 1)
  })

  it('stays out of a hole', () => {
    // A 30x30 square with a 20x20 hole leaves a 5-wide frame, so the pole sits
    // in the middle of one of the four bands, never in the hole.
    const square = c(0, 0, 30, 0, 30, 30, 0, 30)
    const hole = c(5, 5, 25, 5, 25, 25, 5, 25)
    const pt = deepestInteriorPoint([square, hole])!
    expect(inside(pt[0], pt[1], [square, hole])).toBe(true)
    const inHole = pt[0] > 5 && pt[0] < 25 && pt[1] > 5 && pt[1] < 25
    expect(inHole).toBe(false)
  })

  it('lands inside a concave shape whose centroid is outside it', () => {
    // A C shape opening to the right. Its centroid falls in the gap.
    const cShape = c(0, 0, 30, 0, 30, 8, 10, 8, 10, 22, 30, 22, 30, 30, 0, 30)
    const pt = deepestInteriorPoint([cShape])!
    expect(inside(pt[0], pt[1], [cShape])).toBe(true)
    // The spine on the left is the thickest part, so the pole belongs there.
    expect(pt[0]).toBeLessThan(10)
  })

  it('picks the larger part of a shape drawn in two pieces', () => {
    const big = c(0, 0, 20, 0, 20, 20, 0, 20)
    const small = c(40, 0, 44, 0, 44, 4, 40, 4)
    const pt = deepestInteriorPoint([big, small])!
    expect(pt[0]).toBeLessThan(20)
    expect(pt[1]).toBeLessThan(20)
  })

  it('maximises clearance in a non-square rectangle', () => {
    // A 40x10 bar: the pole sits on the mid-line, 5 from either long edge.
    const bar = c(0, 0, 40, 0, 40, 10, 0, 10)
    const pt = deepestInteriorPoint([bar])!
    expect(pt[1]).toBeCloseTo(5, 1)
    expect(pt[0]).toBeGreaterThan(5)
    expect(pt[0]).toBeLessThan(35)
  })

  it('returns null for degenerate input', () => {
    expect(deepestInteriorPoint([])).toBeNull()
    expect(deepestInteriorPoint([c(1, 1)])).toBeNull()
    // A zero-height line encloses no area.
    expect(deepestInteriorPoint([c(0, 0, 10, 0)])).toBeNull()
  })
})
