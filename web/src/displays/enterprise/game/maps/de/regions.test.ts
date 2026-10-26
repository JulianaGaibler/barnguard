import { describe, expect, it } from 'vitest'
import { CITY_ID_TO_STATE_ID, STATE_IDS } from './regions'

describe('German map regions', () => {
  it('has exactly 16 unique state ids', () => {
    expect(STATE_IDS).toHaveLength(16)
    expect(new Set(STATE_IDS).size).toBe(STATE_IDS.length)
  })
})

describe('CITY_ID_TO_STATE_ID', () => {
  it('covers every state exactly once', () => {
    const covered = Object.values(CITY_ID_TO_STATE_ID)
    expect(new Set(covered).size).toBe(STATE_IDS.length)
    for (const id of STATE_IDS) {
      expect(covered).toContain(id)
    }
  })
})
