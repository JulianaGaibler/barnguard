import { describe, expect, it } from 'vitest'
import { SOVEREIGN } from '../game/maps/eu/regions'
import { EU_REGION_META } from '../game/maps/eu/regionMeta'
import { FLAGS, flagFor } from '../ui/flags'
import { nativeName } from './nativeName'

describe('nativeName', () => {
  it('gives Germany its own name beneath the English one', () => {
    expect(nativeName('eu', 'DEU', 'Germany')).toBe('Deutschland')
  })

  it('hides the line when it would repeat the main name', () => {
    expect(nativeName('eu', 'DEU', 'Deutschland')).toBeNull()
  })

  it('writes each country in its own language', () => {
    expect(nativeName('eu', 'FRA', 'France')).toBeNull()
    expect(nativeName('eu', 'ESP', 'Spain')).toBe('España')
    expect(nativeName('eu', 'LUX', 'Luxembourg')).toBe('Lëtzebuerg')
    expect(nativeName('eu', 'MKD', 'North Macedonia')).toBe(
      'Северна Македонија',
    )
  })

  it('names a German state in German', () => {
    expect(nativeName('de', 'BY', 'Bavaria')).toBe('Bayern')
    expect(nativeName('de', 'BY', 'Bayern')).toBeNull()
  })

  it('has nothing for a region or map it does not know', () => {
    expect(nativeName('eu', 'XXX', 'Nowhere')).toBeNull()
    expect(nativeName('zz', 'DEU', 'Germany')).toBeNull()
  })

  it('resolves a real name for every pickable country', () => {
    for (const id of Object.values(SOVEREIGN)) {
      const meta = EU_REGION_META[id]
      const name = new Intl.DisplayNames([meta.lang], { type: 'region' }).of(
        meta.iso2,
      )
      expect(name, id).toBeTruthy()
      expect(name, id).not.toBe(meta.iso2)
    }
  })
})

describe('region metadata', () => {
  it('covers exactly the pickable countries', () => {
    expect(Object.keys(EU_REGION_META).sort()).toEqual(
      Object.values(SOVEREIGN).sort(),
    )
  })

  it('has a flag for every country and no spare ones', () => {
    const codes = Object.values(EU_REGION_META).map((m) => m.iso2)
    for (const code of codes) expect(flagFor(code), code).toMatch(/^<svg/)
    expect(Object.keys(FLAGS).sort()).toEqual([...new Set(codes)].sort())
  })

  it('returns null for a code with no flag', () => {
    expect(flagFor('ZZ')).toBeNull()
  })
})
