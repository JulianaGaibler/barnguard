import { describe, expect, it } from 'vitest'
import { GfxPath } from './GfxPath'

function polygon(points: number[][], close = true): GfxPath {
  const p = new GfxPath()
  points.forEach(([x, y], i) => (i === 0 ? p.moveTo(x, y) : p.lineTo(x, y)))
  if (close) p.close()
  return p
}

function star(): GfxPath {
  const pts: number[][] = []
  for (let i = 0; i < 5; i++) {
    const a = (i * 4 * Math.PI) / 5 - Math.PI / 2
    pts.push([100 + 80 * Math.cos(a), 100 + 80 * Math.sin(a)])
  }
  return polygon(pts)
}

describe('GfxPath', () => {
  it('flattens contours with bounds and closed flags', () => {
    const p = polygon([
      [0, 0],
      [10, 0],
      [10, 5],
    ])
    p.moveTo(20, 20).lineTo(30, 20).lineTo(30, 30)
    const flat = p.flatten(0.25)
    expect(flat.contourCount).toBe(2)
    expect(Array.from(flat.starts.subarray(0, 3))).toEqual([0, 3, 6])
    expect(Array.from(flat.closed.subarray(0, 2))).toEqual([1, 0])
    expect([flat.minX, flat.minY, flat.maxX, flat.maxY]).toEqual([0, 0, 30, 30])
  })

  it('subdivides curves finer at a smaller tolerance', () => {
    const p = new GfxPath()
    p.moveTo(0, 0).cubicTo(0, 100, 100, 100, 100, 0)
    const coarse = p.flatten(4).pointCount
    const fine = p.flatten(0.05).pointCount
    expect(fine).toBeGreaterThan(coarse)
    expect(coarse).toBeGreaterThan(2)
  })

  it('classifies convex outlines, and not stars or dents', () => {
    const square = polygon([
      [0, 0],
      [10, 0],
      [10, 10],
      [0, 10],
    ])
    expect(square.flatten(0.25).convex).toBe(true)
    const dent = polygon([
      [0, 0],
      [10, 0],
      [5, 4],
      [10, 10],
      [0, 10],
    ])
    expect(dent.flatten(0.25).convex).toBe(false)
    // Turns the same way at every vertex but winds twice.
    expect(star().flatten(0.25).convex).toBe(false)
  })

  it('reuses the flatten for an unchanged path and rebuilds after an edit', () => {
    const p = star()
    const a = p.flatten(0.25)
    expect(p.flatten(0.26)).toBe(a)
    const v = p.version
    const count = a.pointCount
    p.moveTo(0, 0).lineTo(1, 1)
    expect(p.version).toBeGreaterThan(v)
    expect(p.flatten(0.25).pointCount).toBe(count + 2)
  })

  it('keeps a flatten per tolerance, so two scales in a frame flatten once each', () => {
    const p = new GfxPath().moveTo(0, 0).quadTo(50, 100, 100, 0)
    const fine = p.flatten(0.05)
    const coarse = p.flatten(2)
    expect(fine.pointCount).toBeGreaterThan(coarse.pointCount)
    expect(p.flatten(0.05)).toBe(fine)
    expect(p.flatten(2)).toBe(coarse)
    expect(fine.pointCount).toBeGreaterThan(coarse.pointCount)
  })

  it('recycles the oldest of its flattens past the limit', () => {
    const p = new GfxPath().moveTo(0, 0).quadTo(50, 100, 100, 0)
    const first = p.flatten(0.05)
    for (const tol of [0.1, 0.2, 0.4, 0.8]) p.flatten(tol)
    expect(p.flatten(0.05)).not.toBe(first)
  })

  it('draws nothing once released', () => {
    const p = star()
    p.release()
    expect(p.released).toBe(true)
    p.lineTo(1, 1)
    expect(p.isEmpty).toBe(true)
  })

  it('drops repeated points and a closing point that repeats the start', () => {
    const p = new GfxPath()
    p.moveTo(0, 0)
      .lineTo(10, 0)
      .lineTo(10, 0)
      .lineTo(10, 10)
      .lineTo(0, 0)
      .close()
    const f = p.flatten(0.25)
    expect(f.pointCount).toBe(3)
    expect(Array.from(f.points.subarray(0, 6))).toEqual([0, 0, 10, 0, 10, 10])
    expect(f.convex).toBe(true)
  })
})
