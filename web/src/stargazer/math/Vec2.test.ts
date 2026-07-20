import { describe, expect, it } from 'vitest'
import {
  vec2,
  vec2Dot,
  vec2Cross,
  vec2CrossSV,
  vec2Perp,
  vec2Normalize,
  vec2Rotate,
  vec2Negate,
} from './Vec2'

describe('vec2Dot', () => {
  it('computes the dot product', () => {
    expect(vec2Dot(vec2(1, 2), vec2(3, 4))).toBe(11)
  })
  it('is zero for perpendicular vectors', () => {
    expect(vec2Dot(vec2(1, 0), vec2(0, 1))).toBe(0)
  })
})

describe('vec2Cross', () => {
  it('is positive when b is CCW from a', () => {
    expect(vec2Cross(vec2(1, 0), vec2(0, 1))).toBe(1)
  })
  it('is negative when b is CW from a', () => {
    expect(vec2Cross(vec2(1, 0), vec2(0, -1))).toBe(-1)
  })
})

describe('vec2CrossSV', () => {
  it('computes ω × r as (-s*y, s*x)', () => {
    const out = vec2()
    vec2CrossSV(out, 2, vec2(3, 4))
    expect(out.x).toBe(-8)
    expect(out.y).toBe(6)
  })
})

describe('vec2Perp', () => {
  it('rotates a quarter turn CCW', () => {
    const out = vec2()
    vec2Perp(out, vec2(1, 0))
    expect(out.x).toBeCloseTo(0, 10)
    expect(out.y).toBe(1)
  })
  it('is safe when dst aliases the input', () => {
    const v = vec2(3, 5)
    vec2Perp(v, v)
    expect(v.x).toBe(-5)
    expect(v.y).toBe(3)
  })
})

describe('vec2Normalize', () => {
  it('returns a unit vector', () => {
    const out = vec2()
    vec2Normalize(out, vec2(3, 4))
    expect(out.x).toBeCloseTo(0.6, 10)
    expect(out.y).toBeCloseTo(0.8, 10)
  })
  it('returns (0,0) for a zero-length input (no NaN)', () => {
    const out = vec2()
    vec2Normalize(out, vec2(0, 0))
    expect(out.x).toBe(0)
    expect(out.y).toBe(0)
  })
})

describe('vec2Rotate', () => {
  it('rotates 90° CCW', () => {
    const out = vec2()
    vec2Rotate(out, vec2(1, 0), Math.PI / 2)
    expect(out.x).toBeCloseTo(0, 10)
    expect(out.y).toBeCloseTo(1, 10)
  })
  it('is safe when dst aliases the input', () => {
    const v = vec2(1, 0)
    vec2Rotate(v, v, Math.PI)
    expect(v.x).toBeCloseTo(-1, 10)
    expect(v.y).toBeCloseTo(0, 10)
  })
})

describe('vec2Negate', () => {
  it('flips both components', () => {
    const out = vec2()
    vec2Negate(out, vec2(2, -3))
    expect(out.x).toBe(-2)
    expect(out.y).toBe(3)
  })
})
