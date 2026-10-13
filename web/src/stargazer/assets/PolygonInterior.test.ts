import { describe, it, expect } from 'vitest'
import { deepestInteriorPoint, interiorThickness } from './PolygonInterior'
import type { SvgPathEntry } from './SvgPathMap'
import { rect } from '../math/Rect'

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

/** An `SvgPathEntry`-shaped stand-in: only `contours` and `triangles` are read. */
function entry(
  contours: Float32Array[],
  triangles: { vertices: number[]; indices: number[] },
): SvgPathEntry {
  return {
    path: new Path2D(),
    bounds: rect(0, 0, 0, 0),
    contours,
    triangles: {
      vertices: new Float32Array(triangles.vertices),
      indices: new Uint16Array(triangles.indices),
    },
  }
}

/** Two triangles covering the axis-aligned rect `w` x `h` at the origin. */
function quad(w: number, h: number): { vertices: number[]; indices: number[] } {
  return {
    vertices: [0, 0, w, 0, w, h, 0, h],
    indices: [0, 1, 2, 0, 2, 3],
  }
}

describe('interiorThickness', () => {
  it('reports a ribbon its own width', () => {
    // 2A/P = 2 * 2000 / 240.
    const strip = entry([c(0, 0, 100, 0, 100, 20, 0, 20)], quad(100, 20))
    expect(interiorThickness(strip)).toBeCloseTo(16.67, 2)
  })

  it('reports a disc its radius', () => {
    const n = 64
    const r = 50
    const ring: number[] = []
    const verts: number[] = [0, 0]
    const idx: number[] = []
    for (let i = 0; i < n; i++) {
      const a = (i / n) * Math.PI * 2
      ring.push(r * Math.cos(a), r * Math.sin(a))
      verts.push(r * Math.cos(a), r * Math.sin(a))
      idx.push(0, 1 + i, 1 + ((i + 1) % n))
    }
    // Within the polygon approximation's own error of r.
    expect(
      interiorThickness(entry([c(...ring)], { vertices: verts, indices: idx })),
    ).toBeCloseTo(r, 0)
  })

  it('counts a hole as a hole, not as more area', () => {
    // A square ring 25 wide: outer 100, inner 50, so the fill is 7500 over a
    // perimeter of 600. Summing the contours' own areas instead would call it
    // 12500 over 600 and report a thickness wider than the ring itself.
    const ring = entry(
      [c(0, 0, 100, 0, 100, 100, 0, 100), c(25, 25, 75, 25, 75, 75, 25, 75)],
      {
        vertices: [
          0, 0, 100, 0, 100, 100, 0, 100, 25, 25, 75, 25, 75, 75, 25, 75,
        ],
        // Four quads around the hole, eight triangles.
        indices: [
          0, 1, 5, 0, 5, 4, 1, 2, 6, 1, 6, 5, 2, 3, 7, 2, 7, 6, 3, 0, 4, 3, 4,
          7,
        ],
      },
    )
    expect(interiorThickness(ring)).toBeCloseTo(25, 2)
  })

  it('is zero without a tessellation to measure', () => {
    const bare: SvgPathEntry = {
      path: new Path2D(),
      bounds: rect(0, 0, 10, 10),
    }
    expect(interiorThickness(bare)).toBe(0)
  })
})
