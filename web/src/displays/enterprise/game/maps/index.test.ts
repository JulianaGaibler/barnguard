import { describe, expect, it } from 'vitest'
import { DEFAULT_MAP_ID, knownMapIds, resolveMapId } from './index'

describe('resolveMapId', () => {
  it('falls back to the default when the parameter is absent', () => {
    // A kiosk URL configured before `?map=` existed has to keep booting.
    expect(resolveMapId(null)).toBe(DEFAULT_MAP_ID)
    expect(resolveMapId(undefined)).toBe(DEFAULT_MAP_ID)
    expect(resolveMapId('')).toBe(DEFAULT_MAP_ID)
  })

  it('returns a known id unchanged', () => {
    for (const id of knownMapIds()) {
      expect(resolveMapId(id)).toBe(id)
    }
  })

  it('throws on an unknown id rather than falling back', () => {
    // Quietly running another map would mean a booth playing the wrong event.
    expect(() => resolveMapId('atlantis')).toThrow(/unknown map/)
  })

  it('ships the default as a known map', () => {
    expect(knownMapIds()).toContain(DEFAULT_MAP_ID)
  })
})
