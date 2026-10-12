import { describe, it, expect } from 'vitest'
import { tessellateContours } from './SvgPathContours'
import type { GeometryHandle } from '../render/gfx/GeometryHandle'

/** An axis-aligned square contour, `reverse` flips its winding direction. */
function square(
  cx: number,
  cy: number,
  half: number,
  reverse = false,
): Float32Array {
  const pts = reverse
    ? [
        [cx - half, cy - half],
        [cx - half, cy + half],
        [cx + half, cy + half],
        [cx + half, cy - half],
      ]
    : [
        [cx - half, cy - half],
        [cx + half, cy - half],
        [cx + half, cy + half],
        [cx - half, cy + half],
      ]
  return new Float32Array(pts.flat())
}

/** Sum of absolute triangle areas, the total region the geometry covers. */
function triangulatedArea(geo: GeometryHandle): number {
  let area = 0
  for (let i = 0; i < geo.indices.length; i += 3) {
    const ia = geo.indices[i]
    const ib = geo.indices[i + 1]
    const ic = geo.indices[i + 2]
    const ax = geo.vertices[ia * 2]
    const ay = geo.vertices[ia * 2 + 1]
    const bx = geo.vertices[ib * 2]
    const by = geo.vertices[ib * 2 + 1]
    const cx = geo.vertices[ic * 2]
    const cy = geo.vertices[ic * 2 + 1]
    area += Math.abs((bx - ax) * (cy - ay) - (cx - ax) * (by - ay)) / 2
  }
  return area
}

describe('tessellateContours', () => {
  it('triangulates disjoint contours independently, same as before hole support', () => {
    const a = square(-20, 0, 5) // area 100
    const b = square(20, 0, 5) // area 100
    const geo = tessellateContours([a, b])
    expect(triangulatedArea(geo)).toBeCloseTo(200, 5)
    // Two triangles per square via earcut's fan triangulation of a quad.
    expect(geo.indices.length).toBe(12)
  })

  it.each([false, true])(
    'subtracts one hole regardless of winding direction (reverse=%s)',
    (reverse) => {
      const outer = square(0, 0, 5) // area 100
      const hole = square(0, 0, 2, reverse) // area 16
      const geo = tessellateContours([outer, hole])
      expect(triangulatedArea(geo)).toBeCloseTo(100 - 16, 5)
    },
  )

  it('fills an island nested inside a hole, not just the ring around it', () => {
    const outer = square(0, 0, 5) // area 100
    const hole = square(0, 0, 3) // area 36, punched out of outer
    const island = square(0, 0, 1) // area 4, solid again inside the hole
    const geo = tessellateContours([outer, hole, island])
    expect(triangulatedArea(geo)).toBeCloseTo(100 - 36 + 4, 5)
  })

  it('classifies a hole that shares a vertex with its container', () => {
    // Outer corner and hole corner both sit at the origin.
    const outer = new Float32Array([0, 0, 10, 0, 10, 10, 0, 10]) // area 100
    const hole = new Float32Array([0, 0, 4, 0, 4, 4, 0, 4]) // area 16
    const geo = tessellateContours([outer, hole])
    expect(triangulatedArea(geo)).toBeCloseTo(100 - 16, 5)
  })

  it('skips a degenerate single-point contour without throwing', () => {
    const square10 = square(0, 0, 5) // area 100
    const degenerate = new Float32Array([1, 1])
    const geo = tessellateContours([square10, degenerate])
    expect(triangulatedArea(geo)).toBeCloseTo(100, 5)
    // The degenerate point still occupies a slot in the vertex buffer, but
    // contributes no triangle.
    expect(geo.vertices.length).toBe(square10.length + degenerate.length)
  })

  it('returns empty geometry for no contours', () => {
    const geo = tessellateContours([])
    expect(geo.vertices.length).toBe(0)
    expect(geo.indices.length).toBe(0)
  })

  it('throws above the 65535-vertex Uint16 index limit', () => {
    const huge = new Float32Array(65_536 * 2)
    expect(() => tessellateContours([huge])).toThrow(/65535/)
  })
})
