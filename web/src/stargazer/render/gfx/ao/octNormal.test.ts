import { describe, expect, it } from 'vitest'
import { octEncode, octDecode } from './octNormal'

/** Directions spread across all octants, including the axis-aligned ones. */
function sampleDirs(): [number, number, number][] {
  const dirs: [number, number, number][] = [
    [0, 0, 1],
    [0, 0, -1],
    [1, 0, 0],
    [0, 1, 0],
  ]
  for (const sx of [-1, 1])
    for (const sy of [-1, 1])
      for (const sz of [-1, 1]) {
        const len = Math.sqrt(3)
        dirs.push([sx / len, sy / len, sz / len])
      }
  return dirs
}

describe('octahedral normal encoding', () => {
  it('round-trips unit vectors within a tight tolerance', () => {
    for (const [nx, ny, nz] of sampleDirs()) {
      const [ex, ey] = octEncode(nx, ny, nz)
      expect(ex).toBeGreaterThanOrEqual(0)
      expect(ex).toBeLessThanOrEqual(1)
      expect(ey).toBeGreaterThanOrEqual(0)
      expect(ey).toBeLessThanOrEqual(1)
      const [dx, dy, dz] = octDecode(ex, ey)
      // The decoded direction should point the same way (dot ≈ 1).
      const dot = nx * dx + ny * dy + nz * dz
      expect(dot).toBeGreaterThan(0.9999)
    }
  })

  it('maps +Z to the texture centre', () => {
    expect(octEncode(0, 0, 1)).toEqual([0.5, 0.5])
  })
})
