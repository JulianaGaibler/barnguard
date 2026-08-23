import { describe, it, expect } from 'vitest'
import { formatPlayerCounts, playerCountsAcross } from './playerCounts'

/** Mirrors the registry's shape without reaching its Svelte components. */
const games = (...counts: number[][]) =>
  counts.map((playerCounts) => ({ meta: { playerCounts } }))

describe('formatPlayerCounts', () => {
  it('collapses a consecutive run to a range', () => {
    expect(formatPlayerCounts([1, 2], 'or')).toBe('1-2')
    expect(formatPlayerCounts([1, 2, 3, 4], 'or')).toBe('1-4')
  })

  it('keeps a gap apart rather than implying the missing count', () => {
    // Orbo plays at 2 or 4. "2-4" would advertise a 3 player game.
    expect(formatPlayerCounts([2, 4], 'or')).toBe('2 or 4')
    expect(formatPlayerCounts([1, 2, 4], 'or')).toBe('1-2 or 4')
  })

  it('renders a lone count bare', () => {
    expect(formatPlayerCounts([1], 'or')).toBe('1')
  })

  it('sorts and dedupes before formatting', () => {
    expect(formatPlayerCounts([4, 2, 2], 'or')).toBe('2 or 4')
  })
})

describe('playerCountsAcross', () => {
  it('offers a chip only for counts some game actually runs at', () => {
    // The arcade's real spread: solo, head to head, and Orbo's four.
    expect(playerCountsAcross(games([2, 4], [1, 2], [1]))).toEqual([1, 2, 4])
  })

  it('leaves out a count no game reaches', () => {
    expect(playerCountsAcross(games([2, 4], [1]))).not.toContain(3)
  })

  it('collapses duplicates across games', () => {
    expect(playerCountsAcross(games([1, 2], [1, 2], [1]))).toEqual([1, 2])
  })
})
