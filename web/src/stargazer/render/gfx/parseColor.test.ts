import { beforeEach, describe, expect, it, vi } from 'vitest'
import { parseColor, _resetParseColorCacheForTests } from './parseColor'

beforeEach(() => {
  _resetParseColorCacheForTests()
})

describe('parseColor, hex', () => {
  it('parses #rrggbb', () => {
    expect(parseColor('#ff8040')).toEqual({
      r: 1,
      g: 128 / 255,
      b: 64 / 255,
      a: 1,
    })
  })

  it('parses #rgb (expands each nibble ×17)', () => {
    // #fff → 255/255 across the board.
    expect(parseColor('#fff')).toEqual({ r: 1, g: 1, b: 1, a: 1 })
    // #08c → r=0, g=136/255, b=204/255.
    const c = parseColor('#08c')
    expect(c.r).toBeCloseTo(0)
    expect(c.g).toBeCloseTo(136 / 255)
    expect(c.b).toBeCloseTo(204 / 255)
    expect(c.a).toBe(1)
  })

  it('parses #rrggbbaa (alpha included)', () => {
    // #00000080 → r=g=b=0, a=128/255.
    const c = parseColor('#00000080')
    expect(c.r).toBe(0)
    expect(c.g).toBe(0)
    expect(c.b).toBe(0)
    expect(c.a).toBeCloseTo(128 / 255)
  })

  it('parses uppercase hex', () => {
    expect(parseColor('#FF8040')).toEqual({
      r: 1,
      g: 128 / 255,
      b: 64 / 255,
      a: 1,
    })
  })

  it('parses a real game color (#0d1a2c)', () => {
    // Clear color used across the codebase.
    const c = parseColor('#0d1a2c')
    expect(c.r).toBeCloseTo(0x0d / 255)
    expect(c.g).toBeCloseTo(0x1a / 255)
    expect(c.b).toBeCloseTo(0x2c / 255)
    expect(c.a).toBe(1)
  })
})

describe('parseColor, rgba / rgb', () => {
  it('parses rgba(r, g, b, a)', () => {
    expect(parseColor('rgba(255, 128, 64, 0.5)')).toEqual({
      r: 1,
      g: 128 / 255,
      b: 64 / 255,
      a: 0.5,
    })
  })

  it('parses rgba() with irregular spacing', () => {
    expect(parseColor('rgba(0,0,0,0.75)')).toEqual({
      r: 0,
      g: 0,
      b: 0,
      a: 0.75,
    })
  })

  it('parses rgb(r, g, b) (opaque)', () => {
    expect(parseColor('rgb(100, 200, 50)')).toEqual({
      r: 100 / 255,
      g: 200 / 255,
      b: 50 / 255,
      a: 1,
    })
  })
})

describe('parseColor, fallback', () => {
  it('unsupported string returns black + warns once', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    try {
      expect(parseColor('rebeccapurple')).toEqual({ r: 0, g: 0, b: 0, a: 1 })
      expect(parseColor('rebeccapurple')).toEqual({ r: 0, g: 0, b: 0, a: 1 })
      // Warned exactly once even after two calls (dedup via `warned` set).
      expect(warn).toHaveBeenCalledTimes(1)
    } finally {
      warn.mockRestore()
    }
  })

  it('empty string returns black', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    try {
      expect(parseColor('')).toEqual({ r: 0, g: 0, b: 0, a: 1 })
    } finally {
      warn.mockRestore()
    }
  })

  it('malformed hex returns black', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    try {
      expect(parseColor('#zzz')).toEqual({ r: 0, g: 0, b: 0, a: 1 })
      expect(parseColor('#12345')).toEqual({ r: 0, g: 0, b: 0, a: 1 })
    } finally {
      warn.mockRestore()
    }
  })
})

describe('parseColor, cache', () => {
  it('returns the same object instance on repeated lookup', () => {
    const a = parseColor('#123456')
    const b = parseColor('#123456')
    expect(a).toBe(b)
  })
})
