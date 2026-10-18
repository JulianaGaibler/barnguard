import { describe, expect, it } from 'vitest'
import type { PostPassContext } from '@src/stargazer'
import {
  DIFFUSION_ROW_LIMIT,
  diffuseCells,
  diffuseTones,
  roundHalfEven,
  toneMap,
} from './errorDiffusion'
import { DEFAULT_DITHER, type DitherSettings } from './params'

function filled(columns: number, rows: number, tone: number): Float32Array {
  return new Float32Array(columns * rows).fill(tone)
}

describe('roundHalfEven', () => {
  it('rounds halves to the even neighbor, as WGSL round does', () => {
    expect([0.5, 1.5, 2.5, 3.5, -0.5, -1.5].map(roundHalfEven)).toEqual([
      0, 2, 2, 4, 0, -2,
    ])
    expect([0.49, 0.51, 1.2, 1.8].map(roundHalfEven)).toEqual([0, 1, 1, 2])
  })
})

describe('toneMap', () => {
  const flat = { gamma: 1, contrast: 1, brightness: 0, invert: false }

  it('leaves a tone alone with the default curve', () => {
    expect(toneMap(0.3, flat)).toBeCloseTo(0.3)
  })

  it('applies gamma, contrast and brightness, clamps, then inverts', () => {
    expect(toneMap(0.25, { ...flat, gamma: 2 })).toBeCloseTo(0.0625)
    expect(toneMap(0.75, { ...flat, contrast: 2 })).toBeCloseTo(1)
    expect(toneMap(0.2, { ...flat, brightness: 0.1 })).toBeCloseTo(0.3)
    expect(toneMap(0.2, { ...flat, invert: true })).toBeCloseTo(0.8)
  })
})

describe('diffuseTones', () => {
  it('spreads the error of a row by the Floyd-Steinberg weights', () => {
    // 0.5 rounds to 0 (the even neighbor) and leaves an error of 0.5. The next
    // cell gets 7/16 of it, 0.71875, which rounds to 1 and leaves -0.28125.
    const row = diffuseTones(filled(4, 1, 0.5), 4, 1, 'floyd-steinberg', 2)
    expect(Array.from(row)).toEqual([0, 1, 0, 1])
  })

  it('keeps the average level close to the tone', () => {
    for (const tone of [0.1, 0.3, 0.5, 0.8]) {
      const result = diffuseTones(
        filled(40, 40, tone),
        40,
        40,
        'floyd-steinberg',
        2,
      )
      const mean = result.reduce((sum, level) => sum + level, 0) / result.length
      expect(mean).toBeCloseTo(tone, 1)
    }
  })

  it('leaves pure black and pure white alone', () => {
    for (const kernel of ['floyd-steinberg', 'atkinson'] as const) {
      expect(
        diffuseTones(filled(8, 8, 0), 8, 8, kernel, 2).every((v) => v === 0),
      ).toBe(true)
      expect(
        diffuseTones(filled(8, 8, 1), 8, 8, kernel, 2).every((v) => v === 1),
      ).toBe(true)
    }
  })

  it('drops a quarter of the error with Atkinson, so mid tones go darker than they are', () => {
    const fs = diffuseTones(filled(40, 40, 0.3), 40, 40, 'floyd-steinberg', 2)
    const atkinson = diffuseTones(filled(40, 40, 0.3), 40, 40, 'atkinson', 2)
    const mean = (values: Float32Array) =>
      values.reduce((a, b) => a + b, 0) / values.length
    expect(mean(atkinson)).toBeLessThan(mean(fs))
  })

  it('rounds to the levels asked for', () => {
    const result = diffuseTones(
      filled(16, 16, 0.4),
      16,
      16,
      'floyd-steinberg',
      3,
    )
    for (const level of result) expect([0, 0.5, 1]).toContain(level)
  })

  it('gives the same result visiting the cells by wavefront, as the shader does', () => {
    // An independent implementation that gathers cell by cell in the order of
    // x + 2y, with the five-wavefront window the compute shader keeps.
    function byWavefront(
      tones: Float32Array,
      columns: number,
      rows: number,
      atkinson: boolean,
    ): Float32Array {
      const kept = 5
      const window = Array.from({ length: kept }, () => new Float64Array(rows))
      const result = new Float32Array(columns * rows)
      const at = (x: number, y: number) =>
        x < 0 || x >= columns || y < 0 || y >= rows
          ? 0
          : window[(x + 2 * y) % kept][y]
      for (let wave = 0; wave < columns + 2 * (rows - 1); wave++) {
        const firstRow = Math.max(0, Math.ceil((wave - (columns - 1)) / 2))
        const lastRow = Math.min(rows - 1, Math.floor(wave / 2))
        for (let y = firstRow; y <= lastRow; y++) {
          const x = wave - 2 * y
          const incoming = atkinson
            ? 0.125 *
              (at(x - 1, y) +
                at(x - 2, y) +
                at(x + 1, y - 1) +
                at(x, y - 1) +
                at(x - 1, y - 1) +
                at(x, y - 2))
            : 0.4375 * at(x - 1, y) +
              0.1875 * at(x + 1, y - 1) +
              0.3125 * at(x, y - 1) +
              0.0625 * at(x - 1, y - 1)
          const value = tones[y * columns + x] + incoming
          const level = Math.min(
            Math.max(roundHalfEven(Math.min(Math.max(value, -0.5), 1.5)), 0),
            1,
          )
          window[wave % kept][y] = value - level
          result[y * columns + x] = level
        }
      }
      return result
    }
    let seed = 7
    const random = () => {
      seed = (seed * 1664525 + 1013904223) >>> 0
      return seed / 4294967296
    }
    for (const [columns, rows] of [
      [1, 1],
      [9, 1],
      [1, 9],
      [17, 11],
      [30, 41],
    ]) {
      const tones = Float32Array.from({ length: columns * rows }, random)
      for (const kernel of ['floyd-steinberg', 'atkinson'] as const) {
        const raster = diffuseTones(tones, columns, rows, kernel, 2)
        const wave = byWavefront(tones, columns, rows, kernel === 'atkinson')
        expect(Array.from(raster), `${columns}x${rows} ${kernel}`).toEqual(
          Array.from(wave),
        )
      }
    }
  })
})

describe('diffuseCells', () => {
  function context(
    width: number,
    height: number,
    uvYDown: boolean,
  ): PostPassContext {
    return { width, height, uvYDown } as PostPassContext
  }
  function cellsOf(
    width: number,
    height: number,
    tone: (x: number, y: number) => number,
    alpha = 255,
  ) {
    const data = new Uint8Array(width * height * 4)
    for (let y = 0; y < height; y++) {
      for (let x = 0; x < width; x++) {
        const at = (y * width + x) * 4
        const value = Math.round(tone(x, y) * alpha)
        data[at] = data[at + 1] = data[at + 2] = value
        data[at + 3] = alpha
      }
    }
    return { data, width, height }
  }
  const run = (
    input: ReturnType<typeof cellsOf>,
    uvYDown: boolean,
    settings: Partial<DitherSettings> = {},
  ) => {
    const output = new Uint8ClampedArray(input.width * input.height * 4)
    diffuseCells(input, output, context(input.width, input.height, uvYDown), {
      ...DEFAULT_DITHER,
      ...settings,
    })
    return output
  }

  it('writes the level into red, opaque, with no other color', () => {
    const output = run(
      cellsOf(6, 6, () => 0.5),
      true,
    )
    for (let at = 0; at < output.length; at += 4) {
      expect([0, 255]).toContain(output[at])
      expect(output[at + 1]).toBe(0)
      expect(output[at + 2]).toBe(0)
      expect(output[at + 3]).toBe(255)
    }
  })

  it('reads the tone of a premultiplied cell by its straight color', () => {
    // Half-covered white: stored as 0.5 white at alpha 0.5, which is full white.
    const half = cellsOf(4, 4, () => 1, 128)
    expect(
      Array.from(run(half, true))
        .filter((_, i) => i % 4 === 0)
        .every((v) => v === 255),
    ).toBe(true)
  })

  it('treats a cell below the alpha threshold as empty', () => {
    const faint = cellsOf(4, 4, () => 1, 30)
    const output = run(faint, true, { alphaThreshold: 0.5 })
    expect(
      Array.from(output)
        .filter((_, i) => i % 4 === 0)
        .every((v) => v === 0),
    ).toBe(true)
  })

  it('diffuses from the top whichever way the texture rows run', () => {
    // A bright top row over a dark rest. Its rows are stored flipped when the
    // texture's row 0 is the bottom.
    const top = (_x: number, y: number) => (y === 0 ? 1 : 0)
    const flipped = (_x: number, y: number) => (y === 3 ? 1 : 0)
    const a = run(cellsOf(5, 4, top), true)
    const b = run(cellsOf(5, 4, flipped), false)
    // The same logical result, so the second is the first with its rows flipped.
    for (let y = 0; y < 4; y++) {
      for (let x = 0; x < 5; x++) {
        expect(b[((3 - y) * 5 + x) * 4]).toBe(a[(y * 5 + x) * 4])
      }
    }
  })

  it('leaves rows past the limit empty, as the compute shader does', () => {
    const rows = DIFFUSION_ROW_LIMIT + 3
    const output = run(
      cellsOf(2, rows, () => 1),
      true,
    )
    expect(output[(rows - 1) * 2 * 4]).toBe(0)
    expect(output[(DIFFUSION_ROW_LIMIT - 1) * 2 * 4]).toBe(255)
  })

  it('uses the palette size as the levels of a ramp', () => {
    const output = run(
      cellsOf(8, 8, () => 0.5),
      true,
      {
        palette: 'ramp',
        colors: ['#000', '#888', '#fff'],
      },
    )
    const reds = new Set(Array.from(output).filter((_, i) => i % 4 === 0))
    expect([...reds].every((v) => [0, 128, 255].includes(v))).toBe(true)
  })
})
