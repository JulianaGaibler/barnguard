import { describe, expect, it } from 'vitest'
import { ALL_VARIANT_CHARS, variantsFor } from './variants'

const LETTERS = Array.from('abcdefghijklmnopqrstuvwxyz')

describe('variantsFor', () => {
  it('lists each accent once, as a single NFC code point', () => {
    for (const base of LETTERS) {
      const list = variantsFor(base, 'en')
      expect(new Set(list).size, base).toBe(list.length)
      for (const ch of list) {
        expect(Array.from(ch), ch).toHaveLength(1)
        expect(ch.normalize('NFC'), ch).toBe(ch)
        expect(ch, ch).toBe(ch.toLowerCase())
      }
    }
  })

  it('has nothing for letters without accents', () => {
    expect(variantsFor('q', 'en')).toEqual([])
    expect(variantsFor('1', 'en')).toEqual([])
  })

  it('puts the locale letters first, in the locale order', () => {
    expect(variantsFor('a', 'de')[0]).toBe('ä')
    expect(variantsFor('o', 'de')[0]).toBe('ö')
    expect(variantsFor('u', 'de')[0]).toBe('ü')
    expect(variantsFor('s', 'de')[0]).toBe('ß')
    expect(variantsFor('c', 'cs')[0]).toBe('č')
  })

  it('keeps every accent whatever the locale', () => {
    expect([...variantsFor('a', 'de')].sort()).toEqual(
      [...variantsFor('a', 'en')].sort(),
    )
  })

  it('reads the language of a regional locale', () => {
    expect(variantsFor('a', 'de-AT')).toEqual(variantsFor('a', 'de'))
  })

  it('falls back to the table order for an unknown locale', () => {
    expect(variantsFor('e', 'xx')).toEqual(variantsFor('e', 'en'))
  })
})

describe('ALL_VARIANT_CHARS', () => {
  it('holds every accent', () => {
    for (const base of LETTERS) {
      for (const ch of variantsFor(base, 'en')) {
        expect(ALL_VARIANT_CHARS.has(ch), ch).toBe(true)
      }
    }
  })
})
