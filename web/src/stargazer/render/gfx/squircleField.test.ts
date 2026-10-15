import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import {
  buildFieldTile,
  cornerOutline,
  FIELD_PATCH_MAX,
  FIELD_PATCH_MIN,
  FIELD_TILE_COUNT,
  FIELD_TILE_SIZE,
  outlineDistance,
  toHalf,
} from './squircleField'

describe('outlineDistance', () => {
  const circular = cornerOutline(0)

  it('is negative inside the corner and positive outside', () => {
    expect(outlineDistance(circular, 1.5, 1.5)[0]).toBeLessThan(0)
    expect(outlineDistance(circular, -0.5, 1.5)[0]).toBeGreaterThan(0)
  })

  it('measures a circular corner around its arc center', () => {
    // At zero smoothing the corner is a quarter circle of radius 1 around the
    // inset point (1, 1), so the outside corner point is √2 − 1 from it.
    const [distance, gx, gy] = outlineDistance(circular, 0, 0)
    expect(distance).toBeCloseTo(Math.SQRT2 - 1, 3)
    expect(gx).toBeCloseTo(-Math.SQRT1_2, 3)
    expect(gy).toBeCloseTo(-Math.SQRT1_2, 3)
  })

  it('measures the straight sides away from the corner', () => {
    const [distance, gx, gy] = outlineDistance(cornerOutline(0.6), 0.3, 1.9)
    expect(distance).toBeCloseTo(-0.3, 3)
    expect(gx).toBeCloseTo(-1, 3)
    expect(gy).toBeCloseTo(0, 3)
  })

  it('pulls a smoothed corner further from the corner point than a circular one', () => {
    const smoothed = outlineDistance(cornerOutline(1), 0, 0)[0]
    expect(smoothed).toBeGreaterThan(outlineDistance(circular, 0, 0)[0])
  })
})

describe('buildFieldTile', () => {
  it('samples texel centers across the patch', () => {
    const tile = buildFieldTile(0)
    const span = FIELD_PATCH_MAX - FIELD_PATCH_MIN
    // The last column's center is half a texel inside the patch's far side,
    // on the inside of the vertical side, deep in the straight part.
    const row = FIELD_TILE_SIZE - 1
    const column = 0
    const insetX = FIELD_PATCH_MIN + (0.5 / FIELD_TILE_SIZE) * span
    const at = (row * FIELD_TILE_SIZE + column) * 4
    expect(tile[at]).toBeCloseTo(-insetX, 3)
  })
})

describe('toHalf', () => {
  it('encodes exact values', () => {
    expect(toHalf(0)).toBe(0)
    expect(toHalf(1)).toBe(0x3c00)
    expect(toHalf(-2)).toBe(0xc000)
    expect(toHalf(0.5)).toBe(0x3800)
  })
})

describe('squircleField.bin', () => {
  // Read from disk: vitest runs from the web package root.
  const shipped = new Uint16Array(
    readFileSync('src/stargazer/render/gfx/squircleField.bin').buffer.slice(0),
  )

  it('holds every tile', () => {
    expect(shipped.length).toBe(
      FIELD_TILE_SIZE * FIELD_TILE_SIZE * FIELD_TILE_COUNT * 4,
    )
  })

  it('matches the generator, so it was rebuilt after the corner math changed', () => {
    const texelsPerTile = FIELD_TILE_SIZE * FIELD_TILE_SIZE * 4
    for (const tile of [0, 12]) {
      const built = buildFieldTile(tile / (FIELD_TILE_COUNT - 1))
      const stored = shipped.subarray(
        tile * texelsPerTile,
        (tile + 1) * texelsPerTile,
      )
      for (let i = 0; i < built.length; i++)
        expect(stored[i]).toBe(toHalf(built[i]))
    }
  })
})

describe('field seam', () => {
  // Past the patch, the shader clamps a point onto the last sampled row or
  // column and carries the rest along the gradient. That only stays
  // continuous if the field there is the plain distance to the straight side.
  const span = FIELD_PATCH_MAX - FIELD_PATCH_MIN
  const center = (i: number) =>
    FIELD_PATCH_MIN + ((i + 0.5) / FIELD_TILE_SIZE) * span
  const last = FIELD_TILE_SIZE - 1

  for (const smoothing of [0, 0.6, 0.95]) {
    it(`meets the straight sides along the far row and column at smoothing ${smoothing}`, () => {
      const tile = buildFieldTile(smoothing)
      for (let i = 0; i < FIELD_TILE_SIZE; i++) {
        const insetX = center(i)
        // Far row: the vertical side is the nearest edge for every column
        // that isn't deeper inside than the row itself.
        if (insetX < center(last)) {
          const at = (last * FIELD_TILE_SIZE + i) * 4
          expect(tile[at]).toBeCloseTo(-insetX, 3)
          expect(tile[at + 1]).toBeCloseTo(-1, 3)
        }
        const atColumn = (i * FIELD_TILE_SIZE + last) * 4
        if (insetX < center(last)) {
          expect(tile[atColumn]).toBeCloseTo(-insetX, 3)
          expect(tile[atColumn + 2]).toBeCloseTo(-1, 3)
        }
      }
    })
  }
})
