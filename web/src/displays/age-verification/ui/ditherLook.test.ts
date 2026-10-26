import { describe, expect, it } from 'vitest'
import { DEFAULT_DITHER, ditherPreset } from '@src/core/render/dither'
import { PALETTE } from '../theme'
import {
  backgroundDither,
  cellShare,
  FixedCells,
  illustrationDither,
  illustrationSettings,
} from './ditherLook'

describe('the display looks', () => {
  it('use only palette colors for ink', () => {
    const palette: string[] = Object.values(PALETTE)
    for (const dither of [backgroundDither(), illustrationDither()]) {
      expect(palette).toContain(dither.settings.ink)
    }
  })

  it('leave the ground of art clear so the background shows through', () => {
    const dither = illustrationDither()
    expect(dither.settings.paper).toBe('rgba(255, 255, 255, 0)')
    expect(dither.settings.alphaThreshold).toBeGreaterThan(0)
  })

  it('give each use its own effect, so one cannot change another', () => {
    const a = illustrationDither()
    const b = illustrationDither()
    a.settings.cellSize = 99
    expect(b.settings.cellSize).not.toBe(99)
  })
})

describe('illustrationSettings', () => {
  const base = { ...DEFAULT_DITHER, cellSize: 5, ink: PALETTE.black }

  it('is the display look when the illustration chooses nothing', () => {
    expect(illustrationSettings(base, undefined)).toEqual(base)
  })

  it('does not hand back the base itself', () => {
    expect(illustrationSettings(base, undefined)).not.toBe(base)
  })

  it('takes a whole preset by name', () => {
    expect(illustrationSettings(base, 'halftoneSphere')).toEqual(
      ditherPreset('halftoneSphere'),
    )
  })

  it('changes only the settings an object names', () => {
    const settings = illustrationSettings(base, { cellSize: 12, dot: 'circle' })
    expect(settings.cellSize).toBe(12)
    expect(settings.dot).toBe('circle')
    expect(settings.ink).toBe(PALETTE.black)
    expect(settings.pattern).toBe(base.pattern)
  })
})

describe('cellShare', () => {
  it('keeps full cells on a monitor and shrinks them toward a phone', () => {
    expect(cellShare(1920)).toBe(1)
    expect(cellShare(1100)).toBe(1)
    expect(cellShare(390)).toBe(0.5)
    expect(cellShare(750)).toBeGreaterThan(0.5)
    expect(cellShare(750)).toBeLessThan(1)
  })
})

describe('FixedCells', () => {
  it('sizes the cells by the window width and keeps that when the design changes', () => {
    const fx = backgroundDither()
    const cells = new FixedCells(fx)
    cells.setDesign(12)
    cells.apply(2, 390)
    expect(fx.settings.cellSize).toBe(12 * 0.5 * 2)
    cells.setDesign(10)
    expect(fx.settings.cellSize).toBe(10 * 0.5 * 2)
    cells.apply(1)
    expect(fx.settings.cellSize).toBe(5)
  })
})
