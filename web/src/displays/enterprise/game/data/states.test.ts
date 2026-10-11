import { describe, expect, it } from 'vitest'
import { CITY_ID_TO_STATE_ID, STATES, STATE_IDS, findState } from './states'

describe('STATES', () => {
  it('has exactly 16 entries', () => {
    expect(STATES).toHaveLength(16)
    expect(STATE_IDS).toHaveLength(16)
  })

  it('has unique ids', () => {
    const set = new Set(STATE_IDS)
    expect(set.size).toBe(STATE_IDS.length)
  })

  it('every STATES entry has i18nKey equal to its id', () => {
    for (const s of STATES) {
      expect(s.i18nKey).toBe(s.id)
    }
  })

  it('geometry + capital fields start as null (filled at asset load)', () => {
    for (const s of STATES) {
      expect(s.capitalWorld).toBeNull()
      expect(s.stateCenter).toBeNull()
      expect(s.half).toBeNull()
    }
  })
})

describe('CITY_ID_TO_STATE_ID', () => {
  it('covers every state exactly once', () => {
    const covered = new Set(Object.values(CITY_ID_TO_STATE_ID))
    expect(covered.size).toBe(STATE_IDS.length)
    for (const id of STATE_IDS) {
      expect(covered.has(id)).toBe(true)
    }
  })
})

describe('findState', () => {
  it('returns the entry for known ids', () => {
    expect(findState('BW').id).toBe('BW')
    expect(findState('BY').i18nKey).toBe('BY')
  })

  it('throws for unknown ids', () => {
    // @ts-expect-error, deliberately passing an invalid StateId.
    expect(() => findState('XX')).toThrow()
  })
})
