import { describe, expect, it } from 'vitest'
import { vec2, type Vec2 } from './Vec2'
import {
  polygonArea,
  polygonCentroid,
  polygonComputeNormals,
  polygonMomentOfInertia,
} from './polygon'

// Unit square centered at the origin, wound CCW.
const SQUARE: Vec2[] = [vec2(-1, -1), vec2(1, -1), vec2(1, 1), vec2(-1, 1)]

describe('polygonArea', () => {
  it('is positive for CCW winding', () => {
    expect(polygonArea(SQUARE)).toBe(4)
  })
  it('is negative for CW winding', () => {
    const cw = [...SQUARE].reverse()
    expect(polygonArea(cw)).toBe(-4)
  })
})

describe('polygonCentroid', () => {
  it('finds the center of a centered square', () => {
    const c = polygonCentroid(vec2(), SQUARE)
    expect(c.x).toBeCloseTo(0, 10)
    expect(c.y).toBeCloseTo(0, 10)
  })
  it('finds the center of an offset square', () => {
    const offset = SQUARE.map((v) => vec2(v.x + 10, v.y + 5))
    const c = polygonCentroid(vec2(), offset)
    expect(c.x).toBeCloseTo(10, 10)
    expect(c.y).toBeCloseTo(5, 10)
  })
})

describe('polygonComputeNormals', () => {
  it('produces four outward unit normals for a CCW square', () => {
    const normals = polygonComputeNormals([], SQUARE)
    expect(normals).toHaveLength(4)
    // Edge 0: (-1,-1)->(1,-1) bottom edge, outward normal points down (0,-1).
    expect(normals[0].x).toBeCloseTo(0, 10)
    expect(normals[0].y).toBeCloseTo(-1, 10)
    // Edge 1: (1,-1)->(1,1) right edge, outward normal points right (1,0).
    expect(normals[1].x).toBeCloseTo(1, 10)
    expect(normals[1].y).toBeCloseTo(0, 10)
    for (const n of normals) {
      expect(Math.hypot(n.x, n.y)).toBeCloseTo(1, 10)
    }
  })
})

describe('polygonMomentOfInertia', () => {
  it('matches the analytic value for a square about its center', () => {
    // Solid square side s=2, mass m: I = m*(s^2 + s^2)/12 = m*8/12 = 2m/3.
    const m = 3
    const I = polygonMomentOfInertia(SQUARE, m, vec2(0, 0))
    expect(I).toBeCloseTo((2 * m) / 3, 10)
  })
})
