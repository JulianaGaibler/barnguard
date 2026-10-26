import { describe, expect, it } from 'vitest'
import {
  emptyHighScores,
  mapHigh,
  regionHigh,
  type EnterpriseHighScores,
} from './game-log'

const scores: EnterpriseHighScores = {
  display: 'enterprise',
  byMap: { de: 100, eu: 250 },
  byState: { de: { BY: 100, HE: 40 }, eu: { BY: 250 } },
}

describe('high scores per map', () => {
  it('keeps the same region id apart across maps', () => {
    // `BY` is a German state and, on another map, could be any region. The
    // two must never share a best score.
    expect(regionHigh(scores, 'de', 'BY')).toBe(100)
    expect(regionHigh(scores, 'eu', 'BY')).toBe(250)
  })

  it('reports a best per map rather than one across the display', () => {
    expect(mapHigh(scores, 'de')).toBe(100)
    expect(mapHigh(scores, 'eu')).toBe(250)
  })

  it('reads zero for a map or region with nothing recorded', () => {
    expect(mapHigh(scores, 'atlantis')).toBe(0)
    expect(regionHigh(scores, 'de', 'XX')).toBe(0)
    expect(regionHigh(scores, 'atlantis', 'BY')).toBe(0)
  })

  it('starts empty without throwing on any lookup', () => {
    const empty = emptyHighScores()
    expect(mapHigh(empty, 'de')).toBe(0)
    expect(regionHigh(empty, 'de', 'BY')).toBe(0)
  })
})
