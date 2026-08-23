import { describe, expect, it, vi } from 'vitest'
import {
  isBlankRaster,
  rasterizeSvg,
  sizeSvgSource,
  svgViewBoxSize,
} from './rasterizeSvg'

describe('svgViewBoxSize', () => {
  it('reads the viewBox extent', () => {
    expect(svgViewBoxSize('<svg viewBox="0 0 42 26">')).toEqual({
      w: 42,
      h: 26,
    })
  })

  it('tolerates a negative origin and leading space', () => {
    expect(svgViewBoxSize('<svg viewBox=" -8 -8 40 40">')).toEqual({
      w: 40,
      h: 40,
    })
  })

  it('returns null without a viewBox, and for a degenerate one', () => {
    expect(svgViewBoxSize('<svg width="10">')).toBeNull()
    expect(svgViewBoxSize('<svg viewBox="0 0 0 40">')).toBeNull()
  })
})

describe('sizeSvgSource', () => {
  it('replaces the intrinsic size and leaves the viewBox alone', () => {
    const out = sizeSvgSource(
      '<svg width="28" height="40" viewBox="0 0 28 40"><g/></svg>',
      112,
      160,
    )
    expect(out).toContain('width="112"')
    expect(out).toContain('height="160"')
    expect(out).not.toContain('width="28"')
    expect(out).toContain('viewBox="0 0 28 40"')
  })

  it('adds a size to an SVG that had none', () => {
    const out = sizeSvgSource('<svg viewBox="0 0 8 8"><g/></svg>', 32, 32)
    expect(out).toContain('<svg width="32" height="32"')
  })

  it('leaves a source with no root tag untouched', () => {
    expect(sizeSvgSource('not svg', 10, 10)).toBe('not svg')
  })
})

describe('rasterizeSvg', () => {
  // Headless has no SVG decoder, so the decode times out and the blank
  // fallback comes back. What matters is that it resolves at the right size
  // rather than rejecting.
  it('resolves a correctly sized blank canvas when nothing can decode', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    const canvas = await rasterizeSvg('<svg viewBox="0 0 17 20"/>', {
      scale: 4,
      timeoutMs: 20,
    })
    expect(canvas.width).toBe(68)
    expect(canvas.height).toBe(80)
    expect(isBlankRaster(canvas)).toBe(true)
    warn.mockRestore()
  })

  it('honours an explicit size over the scale', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    const canvas = await rasterizeSvg('<svg viewBox="0 0 17 20"/>', {
      scale: 4,
      width: 34,
      height: 40,
      timeoutMs: 20,
    })
    expect(canvas.width).toBe(34)
    expect(canvas.height).toBe(40)
    warn.mockRestore()
  })

  it('falls back to a square when the source has no viewBox', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    const canvas = await rasterizeSvg('<svg/>', { timeoutMs: 20 })
    expect(canvas.width).toBe(64)
    expect(canvas.height).toBe(64)
    warn.mockRestore()
  })
})
