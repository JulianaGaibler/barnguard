import { describe, it, expect } from 'vitest'
import { BoxConstraints, edgeInsets, type Size } from './constraints'

describe('BoxConstraints', () => {
  it('tight() forces min === max on both axes', () => {
    const c = BoxConstraints.tight(200, 80)
    expect([c.minW, c.maxW, c.minH, c.maxH]).toEqual([200, 200, 80, 80])
    expect(c.constrainW(999)).toBe(200)
    expect(c.constrainH(0)).toBe(80)
  })

  it('loose() has zero minimum up to the maxima', () => {
    const c = BoxConstraints.loose(300, 150)
    expect([c.minW, c.maxW, c.minH, c.maxH]).toEqual([0, 300, 0, 150])
    expect(c.constrainW(500)).toBe(300)
    expect(c.constrainW(120)).toBe(120)
  })

  it('constrainW/H clamp into range', () => {
    const c = new BoxConstraints().set(40, 100, 10, 50)
    expect(c.constrainW(10)).toBe(40)
    expect(c.constrainW(70)).toBe(70)
    expect(c.constrainW(200)).toBe(100)
    expect(c.constrainH(5)).toBe(10)
    expect(c.constrainH(50)).toBe(50)
  })

  it('reports bounded vs unbounded axes', () => {
    const loose = BoxConstraints.loose(Infinity, 100)
    expect(loose.hasBoundedW).toBe(false)
    expect(loose.hasBoundedH).toBe(true)
    // An unbounded axis clamps only against the minimum.
    expect(loose.constrainW(9999)).toBe(9999)
  })

  it('deflate() shrinks the bounded maxima and floors at zero', () => {
    const c = new BoxConstraints().set(0, 300, 0, 200)
    const out = new BoxConstraints()
    c.deflate(edgeInsets(10, 20), out) // 20 horizontal, 10 vertical each edge
    expect(out.maxW).toBe(300 - 40)
    expect(out.maxH).toBe(200 - 20)
    // Padding larger than the space floors the max at 0, not negative.
    const tiny = new BoxConstraints().set(0, 30, 0, 30)
    tiny.deflate(edgeInsets(50), out)
    expect(out.maxW).toBe(0)
    expect(out.maxH).toBe(0)
  })

  it('deflate() keeps an unbounded axis unbounded', () => {
    const c = BoxConstraints.loose(Infinity, Infinity)
    const out = new BoxConstraints()
    c.deflate(edgeInsets(16), out)
    expect(out.maxW).toBe(Infinity)
    expect(out.maxH).toBe(Infinity)
  })

  it('constrain() writes a clamped size into out', () => {
    const c = new BoxConstraints().set(0, 100, 0, 100)
    const out: Size = { w: 0, h: 0 }
    c.constrain(250, 40, out)
    expect(out).toEqual({ w: 100, h: 40 })
  })
})

describe('edgeInsets', () => {
  it('one arg insets all edges', () => {
    expect(edgeInsets(12)).toEqual({ top: 12, right: 12, bottom: 12, left: 12 })
  })
  it('two args set vertical then horizontal', () => {
    expect(edgeInsets(8, 24)).toEqual({
      top: 8,
      right: 24,
      bottom: 8,
      left: 24,
    })
  })
  it('four args set top, right, bottom, left', () => {
    expect(edgeInsets(1, 2, 3, 4)).toEqual({
      top: 1,
      right: 2,
      bottom: 3,
      left: 4,
    })
  })
})
