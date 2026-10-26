import { describe, expect, it } from 'vitest'
import { ALL_VARIANT_CHARS } from '@src/core/ui/keyboard/variants'
import { displayName } from './displayName'

describe('displayName', () => {
  it('sets a name in capitals', () => {
    expect(displayName('yaina')).toBe('YAINA')
  })

  it('keeps ß as one capital letter', () => {
    expect(displayName('straße')).toBe('STRAẞE')
  })

  it('keeps the length of every accent the keyboard types', () => {
    for (const ch of ALL_VARIANT_CHARS) {
      expect(Array.from(displayName(ch)), ch).toHaveLength(1)
    }
  })
})
