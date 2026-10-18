import { describe, expect, it } from 'vitest'
import { DEFAULT_DITHER, type DitherSettings } from './params'
import { DITHER_PRESETS, ditherPreset, type DitherPresetName } from './presets'

const names = Object.keys(DITHER_PRESETS) as DitherPresetName[]

describe('presets', () => {
  it('only set settings that exist', () => {
    for (const name of names) {
      const { description, ...settings } = DITHER_PRESETS[name]
      expect(description.length).toBeGreaterThan(0)
      for (const key of Object.keys(settings)) {
        expect(key in DEFAULT_DITHER).toBe(true)
      }
    }
  })

  it('give a ramp or nearest palette its colors, at most 16', () => {
    for (const name of names) {
      const preset = ditherPreset(name)
      if (preset.palette === 'ramp' || preset.palette === 'nearest') {
        expect(preset.colors.length).toBeGreaterThan(1)
      }
      expect(preset.colors.length).toBeLessThanOrEqual(16)
    }
  })

  it('apply overrides over the preset and leave the preset alone', () => {
    const changed = ditherPreset('stageMountain', {
      cellSize: 12,
      ink: '#ff453f',
    })
    expect(changed.cellSize).toBe(12)
    expect(changed.ink).toBe('#ff453f')
    expect(changed.pattern).toBe('bayer8')
    expect(ditherPreset('stageMountain').cellSize).toBe(7)
  })

  it('return a settings object that is safe to edit', () => {
    const a: DitherSettings = ditherPreset('stippleCloud')
    a.cellSize = 99
    expect(ditherPreset('stippleCloud').cellSize).toBe(3)
  })
})
