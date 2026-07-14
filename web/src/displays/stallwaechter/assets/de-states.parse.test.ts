import { describe, expect, it } from 'vitest'
import { parseSvgPaths } from '@src/stargazer'

/**
 * Regression: the Stallwächter map SVG must parse to exactly the 16
 * Bundesländer, keyed by ISO code, with non-empty bounds. This lived in the
 * engine's test suite before the multi-display refactor moved German-specific
 * geography here.
 */
describe('Stallwächter de-states.svg', () => {
  it('parses into exactly the 16 Bundesländer with non-empty bounds', async () => {
    const raw = (await import('./de-states.svg?raw')).default
    const map = parseSvgPaths(raw)
    const expected = new Set([
      'BB',
      'BE',
      'BW',
      'BY',
      'HB',
      'HE',
      'HH',
      'MV',
      'NI',
      'NW',
      'RP',
      'SH',
      'SL',
      'SN',
      'ST',
      'TH',
    ])
    expect(map.paths.size).toBe(16)
    for (const id of expected) {
      const entry = map.paths.get(id)
      expect(entry, `state ${id} missing`).toBeDefined()
      expect(entry!.bounds.width).toBeGreaterThan(0)
      expect(entry!.bounds.height).toBeGreaterThan(0)
    }
  })
})
