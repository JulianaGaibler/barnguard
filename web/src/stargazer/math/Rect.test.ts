import { describe, expect, it } from 'vitest'
import {
  rect,
  rectPointAt,
  rectPercentOf,
  rectMargins,
  clampRectToBounds,
} from './Rect'

describe('rectPointAt', () => {
  const r = rect(10, 20, 200, 100)
  it('maps edge and center fractions to points', () => {
    expect(rectPointAt(r, 0, 0)).toEqual({ x: 10, y: 20 })
    expect(rectPointAt(r, 0.5, 0.5)).toEqual({ x: 110, y: 70 })
    expect(rectPointAt(r, 1, 1)).toEqual({ x: 210, y: 120 })
  })
  it('extrapolates past the edges for fractions outside [0, 1]', () => {
    expect(rectPointAt(r, -0.1, 1.5)).toEqual({ x: -10, y: 170 })
  })
})

describe('rectPercentOf', () => {
  const r = rect(10, 20, 200, 100)
  it('is the inverse of rectPointAt', () => {
    const p = rectPointAt(r, 0.3, 0.8)
    expect(rectPercentOf(r, p.x, p.y)).toEqual({ x: 0.3, y: 0.8 })
  })
  it('reports 0 on a zero-size axis instead of NaN', () => {
    expect(rectPercentOf(rect(5, 5, 0, 0), 5, 5)).toEqual({ x: 0, y: 0 })
  })
})

describe('rectMargins', () => {
  const container = rect(0, 0, 100, 100)
  // Right edge at 70, bottom edge at 80.
  const inner = rect(30, 20, 40, 60)
  const m = rectMargins(container, inner)

  it('bands each side, spanning the full cross axis', () => {
    expect(m.left).toEqual({ x: 0, y: 0, width: 30, height: 100 })
    expect(m.right).toEqual({ x: 70, y: 0, width: 30, height: 100 })
    expect(m.top).toEqual({ x: 0, y: 0, width: 100, height: 20 })
    expect(m.bottom).toEqual({ x: 0, y: 80, width: 100, height: 20 })
  })

  it('centers within a side band inside the gap', () => {
    expect(rectPointAt(m.left, 0.5, 0.5)).toEqual({ x: 15, y: 50 })
  })

  it('clamps a band to zero when inner reaches that edge', () => {
    // Inner flush against the left, top, and right; only a bottom gap remains.
    const flush = rectMargins(container, rect(0, 0, 100, 40))
    expect(flush.left.width).toBe(0)
    expect(flush.right.width).toBe(0)
    expect(flush.top.height).toBe(0)
    expect(flush.bottom.height).toBe(60)
  })
})

describe('clampRectToBounds', () => {
  const bounds = rect(0, 0, 100, 100)

  it('leaves a rect already inside untouched', () => {
    const r = rect(20, 20, 30, 30)
    expect(clampRectToBounds(r, bounds)).toEqual(r)
  })

  it('pushes a rect back inside on each edge', () => {
    expect(clampRectToBounds(rect(-10, -10, 30, 30), bounds)).toEqual({
      x: 0,
      y: 0,
      width: 30,
      height: 30,
    })
    expect(clampRectToBounds(rect(90, 90, 30, 30), bounds)).toEqual({
      x: 70,
      y: 70,
      width: 30,
      height: 30,
    })
  })

  it('respects the margin inset', () => {
    expect(clampRectToBounds(rect(-10, -10, 30, 30), bounds, 5)).toMatchObject({
      x: 5,
      y: 5,
    })
    expect(clampRectToBounds(rect(200, 200, 30, 30), bounds, 5)).toMatchObject({
      x: 65,
      y: 65,
    })
  })

  it('pins to the start edge when the rect is larger than the inset area', () => {
    expect(clampRectToBounds(rect(50, 50, 200, 200), bounds, 10)).toMatchObject(
      {
        x: 10,
        y: 10,
      },
    )
  })
})
