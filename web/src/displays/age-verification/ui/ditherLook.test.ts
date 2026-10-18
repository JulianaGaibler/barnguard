import { describe, expect, it } from 'vitest'
import { DEFAULT_DITHER, ditherPreset } from '@src/core/render/dither'
import { PALETTE } from '../theme'
import {
  backgroundDither,
  illustrationDither,
  illustrationSettings,
  splashDither,
} from './ditherLook'

describe('the display looks', () => {
  it('use only palette colors for ink', () => {
    const palette: string[] = Object.values(PALETTE)
    for (const dither of [
      backgroundDither(),
      illustrationDither(),
      splashDither(),
    ]) {
      expect(palette).toContain(dither.settings.ink)
    }
  })

  it('leave the ground of art clear so the background shows through', () => {
    for (const dither of [illustrationDither(), splashDither()]) {
      expect(dither.settings.paper).toBe('rgba(255, 255, 255, 0)')
      expect(dither.settings.alphaThreshold).toBeGreaterThan(0)
    }
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
