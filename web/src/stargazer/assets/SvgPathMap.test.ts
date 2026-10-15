import { describe, expect, it } from 'vitest'
import { parseSvgPaths, computePathBounds, scaleSvgPath } from './SvgPathMap'

describe('parseSvgPaths', () => {
  it('extracts viewBox and paths keyed by id', () => {
    const raw = `<?xml version="1.0"?>
      <svg xmlns="http://www.w3.org/2000/svg" viewBox="10 20 100 200">
        <path id="a" d="M 0 0 L 10 10 Z" />
        <path id="b" d="M 5 5 L 15 15 Z" />
      </svg>`
    const map = parseSvgPaths(raw)
    expect(map.viewBox).toEqual({ x: 10, y: 20, width: 100, height: 200 })
    expect(map.paths.size).toBe(2)
    expect(map.paths.has('a')).toBe(true)
    expect(map.paths.has('b')).toBe(true)
  })

  it('generates a fallback id when a path has none', () => {
    const raw =
      '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 10 10"><path d="M0 0"/></svg>'
    const map = parseSvgPaths(raw)
    expect(map.paths.size).toBe(1)
    expect(map.paths.has('path-0')).toBe(true)
  })

  it('falls back to width/height when viewBox is missing', () => {
    const raw =
      '<svg xmlns="http://www.w3.org/2000/svg" width="500" height="300"><path id="p" d="M0 0"/></svg>'
    const map = parseSvgPaths(raw)
    expect(map.viewBox).toEqual({ x: 0, y: 0, width: 500, height: 300 })
  })

  it('scales the paths and the viewBox by the scale option', () => {
    const raw =
      '<svg xmlns="http://www.w3.org/2000/svg" viewBox="10 0 100 50"><path id="p" d="M10 10 L30 20 Z"/></svg>'
    const map = parseSvgPaths(raw, { scale: 0.5 })
    expect(map.viewBox).toEqual({ x: 5, y: 0, width: 50, height: 25 })
    expect(map.paths.get('p')?.bounds).toEqual({
      x: 5,
      y: 5,
      width: 10,
      height: 5,
    })
  })

  it('throws on invalid XML', () => {
    expect(() => parseSvgPaths('<svg><path')).toThrow()
  })

  it('parses the engine dev fixture via the Vite ?raw loader end-to-end', async () => {
    // Import via Vite's `?raw` loader so the test exercises the same code
    // path as production.
    const raw = (await import('@src/stargazer/dev/fixtures/shapes.svg?raw'))
      .default
    const map = parseSvgPaths(raw)
    expect(map.paths.size).toBeGreaterThanOrEqual(4)
    for (const [id, entry] of map.paths) {
      expect(entry.bounds.width, `path ${id} width`).toBeGreaterThan(0)
      expect(entry.bounds.height, `path ${id} height`).toBeGreaterThan(0)
    }
  })
})

describe('scaleSvgPath', () => {
  it('scales coordinates across repeated and relative commands', () => {
    expect(scaleSvgPath('M1 2 3 4h5v-6c1 2 3 4 5 6Z', 2)).toBe(
      'M 2 4 6 8 h 10 v -12 c 2 4 6 8 10 12 Z',
    )
  })

  it('keeps an arc rotation and flags unscaled', () => {
    expect(scaleSvgPath('A 10 20 30 1 0 40 50', 2)).toBe(
      'A 20 40 30 1 0 80 100',
    )
  })
})

describe('computePathBounds', () => {
  it('bounds a triangle M/L/Z path exactly', () => {
    const r = computePathBounds('M 10 20 L 100 20 L 50 100 Z')
    expect(r.x).toBe(10)
    expect(r.y).toBe(20)
    expect(r.width).toBe(90)
    expect(r.height).toBe(80)
  })

  it('handles H and V (horizontal / vertical) commands', () => {
    const r = computePathBounds('M 0 0 H 50 V 30 Z')
    expect(r.x).toBe(0)
    expect(r.y).toBe(0)
    expect(r.width).toBe(50)
    expect(r.height).toBe(30)
  })

  it('handles relative commands (m/l)', () => {
    // Same triangle as the M/L case above, but authored with relative moves.
    const r = computePathBounds('m 10 20 l 90 0 l -50 80 z')
    expect(r.x).toBe(10)
    expect(r.y).toBe(20)
    expect(r.width).toBe(90)
    expect(r.height).toBe(80)
  })

  it('conservatively bounds cubic Bezier control points', () => {
    // A single cubic, bounds are the convex hull of the control polygon,
    // which is a superset of the true curve extent.
    const r = computePathBounds('M 0 0 C 50 100 50 -100 100 0')
    expect(r.x).toBe(0)
    expect(r.width).toBe(100)
    // Control-polygon y range is [-100, 100].
    expect(r.y).toBe(-100)
    expect(r.height).toBe(200)
  })

  it('follows implicit L continuation after M', () => {
    // M 0 0  1 1  2 2, after the M, the (1 1) and (2 2) pairs are implicit
    // line-tos, not extra M targets.
    const r = computePathBounds('M 0 0 1 1 2 2')
    expect(r.width).toBe(2)
    expect(r.height).toBe(2)
  })

  it('returns a zero rect for empty input', () => {
    expect(computePathBounds('')).toEqual({ x: 0, y: 0, width: 0, height: 0 })
  })
})
