import { describe, expect, it } from 'vitest'
import { ALL_PATH_KEYS, DRAWN_ONLY, SOVEREIGN } from './regions'
import { de } from '../../../i18n/de'
import { en } from '../../../i18n/en'

describe('European map regions', () => {
  it('splits the drawn countries into 44 pickable and 7 drawn-only', () => {
    expect(Object.keys(SOVEREIGN)).toHaveLength(44)
    expect(Object.keys(DRAWN_ONLY)).toHaveLength(7)
    expect(ALL_PATH_KEYS).toHaveLength(51)
  })

  it('keeps dependencies and contested territory unpickable', () => {
    // Drawn as landmass, never offered: five dependencies that are not
    // countries, and two territories whose status is disputed.
    for (const id of ['FRO', 'GGY', 'GIB', 'IMN', 'JEY', 'CYN', 'RKS']) {
      expect(Object.values(DRAWN_ONLY)).toContain(id)
      expect(Object.values(SOVEREIGN)).not.toContain(id)
    }
  })

  it('maps every path key exactly once', () => {
    expect(new Set(ALL_PATH_KEYS).size).toBe(ALL_PATH_KEYS.length)
    const ids = [...Object.values(SOVEREIGN), ...Object.values(DRAWN_ONLY)]
    expect(new Set(ids).size).toBe(ids.length)
  })

  it('strips the export tool prefix and suffixes', () => {
    // Path keys carry a `g` prefix, and two are suffixed rather than named
    // after their country.
    expect(SOVEREIGN.gFI1).toBe('FIN')
    expect(SOVEREIGN.gFR1).toBe('FRA')
    for (const [key, id] of Object.entries(SOVEREIGN)) {
      expect(key.startsWith('g')).toBe(true)
      expect(id).toMatch(/^[A-Z]{3}$/)
    }
  })

  it('names every pickable country in both locales', () => {
    for (const id of Object.values(SOVEREIGN)) {
      const deName = (de.countries as Record<string, string>)[id]
      const enName = (en.countries as Record<string, string>)[id]
      expect(deName, `de name for ${id}`).toBeTruthy()
      expect(enName, `en name for ${id}`).toBeTruthy()
    }
  })

  it('ships no names for regions it never offers', () => {
    // A name here would imply the region is pickable.
    for (const id of Object.values(DRAWN_ONLY)) {
      expect((de.countries as Record<string, string>)[id]).toBeUndefined()
    }
  })
})
