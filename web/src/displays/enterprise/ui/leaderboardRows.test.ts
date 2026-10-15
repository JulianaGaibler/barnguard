import { describe, expect, it } from 'vitest'
import type { LeaderboardEntry } from '@src/core/leaderboard/leaderboardClient'
import { emptyHighScores } from '@src/displays/enterprise/game-log'
import { leaderboardRows, mapBest, normalizeName } from './leaderboardRows'

function board(...scores: number[]): LeaderboardEntry[] {
  return scores.map((score, i) => ({
    id: String(i),
    tsMs: i,
    display: 'enterprise-eu',
    name: `p${i}`,
    score,
    region: 'DEU',
  }))
}

describe('leaderboardRows', () => {
  it('shows the top of the board with no pending entry', () => {
    const rows = leaderboardRows(board(9, 8, 7, 6, 5, 4, 3, 2, 1, 0), null)
    expect(rows.map((r) => r.score)).toEqual([9, 8, 7, 6, 5, 4, 3, 2])
    expect(rows.map((r) => r.rank)).toEqual([1, 2, 3, 4, 5, 6, 7, 8])
  })

  it('places the pending entry by score, after an equal one', () => {
    const rows = leaderboardRows(board(14, 13, 11, 10), {
      name: '',
      score: 11,
      region: 'FRA',
    })
    expect(rows.map((r) => r.score)).toEqual([14, 13, 11, 11, 10])
    expect(rows[3].pending).toBe(true)
    // Equal to the row above it, so it shares that place.
    expect(rows[3].rank).toBe(3)
    expect(rows[4].rank).toBe(5)
  })

  it('centres the window on a pending entry below the top rows', () => {
    const scores = Array.from({ length: 20 }, (_, i) => 100 - i)
    const rows = leaderboardRows(board(...scores), {
      name: '',
      score: 85.5,
      region: 'FRA',
    })
    const pendingAt = rows.findIndex((r) => r.pending)
    expect(rows).toHaveLength(8)
    expect(pendingAt).toBe(4)
    expect(rows[pendingAt].rank).toBe(16)
  })

  it('clamps the window at the bottom of the board', () => {
    const scores = Array.from({ length: 12 }, (_, i) => 100 - i)
    const rows = leaderboardRows(board(...scores), {
      name: '',
      score: 1,
      region: 'FRA',
    })
    expect(rows).toHaveLength(8)
    expect(rows[7].pending).toBe(true)
    expect(rows[7].rank).toBe(13)
  })

  it('merges a typed name with its row and keeps the better score', () => {
    const rows = leaderboardRows(board(20, 10, 5), {
      name: ' P1 ',
      score: 30,
      region: 'FRA',
    })
    expect(rows.map((r) => r.score)).toEqual([30, 20, 5])
    expect(rows[0].pending).toBe(true)
    expect(rows[0].keepsBest).toBe(false)
  })

  it('shows the saved best when the typed name already scored higher', () => {
    const rows = leaderboardRows(board(20, 10, 5), {
      name: 'p0',
      score: 7,
      region: 'FRA',
    })
    expect(rows.map((r) => r.score)).toEqual([20, 10, 5])
    expect(rows[0].pending).toBe(true)
    expect(rows[0].keepsBest).toBe(true)
  })

  it('handles an empty board', () => {
    expect(leaderboardRows([], null)).toEqual([])
    const rows = leaderboardRows([], { name: '', score: 3, region: 'DEU' })
    expect(rows).toEqual([
      {
        rank: 1,
        name: '',
        region: 'DEU',
        score: 3,
        pending: true,
        keepsBest: false,
        anonymous: false,
      },
    ])
  })
})

describe('normalizeName', () => {
  it('matches the server: trimmed, lowercase, twelve characters', () => {
    expect(normalizeName('  Anna-Lena  ')).toBe('anna-lena')
    expect(normalizeName('ABCDEFGHIJKLMNOP')).toBe('abcdefghijkl')
  })
})

describe('leaderboardRows places', () => {
  it('gives equal scores the same place and skips the next', () => {
    const rows = leaderboardRows(board(14, 12, 12, 10), null)
    expect(rows.map((r) => r.rank)).toEqual([1, 2, 2, 4])
  })
})

describe('leaderboardRows unnamed best', () => {
  it('heads the board with a map best nobody named', () => {
    const rows = leaderboardRows(board(10, 8), null, {
      score: 15,
      region: 'ITA',
    })
    expect(rows[0]).toMatchObject({
      rank: 1,
      score: 15,
      region: 'ITA',
      anonymous: true,
    })
    expect(rows[1].rank).toBe(2)
  })

  it('leaves it out once a named score reaches it', () => {
    const rows = leaderboardRows(board(15, 8), null, {
      score: 15,
      region: 'ITA',
    })
    expect(rows.some((r) => r.anonymous)).toBe(false)
  })

  it('leaves it out when the round on screen is that best', () => {
    const rows = leaderboardRows(
      board(10, 8),
      { name: '', score: 15, region: 'ITA' },
      { score: 15, region: 'ITA' },
    )
    expect(rows.some((r) => r.anonymous)).toBe(false)
    expect(rows[0].pending).toBe(true)
  })

  it('places a lower round beneath it', () => {
    const rows = leaderboardRows(
      board(10, 8),
      { name: '', score: 9, region: 'FRA' },
      { score: 15, region: 'ITA' },
    )
    expect(rows.map((r) => r.score)).toEqual([15, 10, 9, 8])
    expect(rows[2].pending).toBe(true)
    expect(rows[2].rank).toBe(3)
  })

  it('never merges a typed name into the unnamed row', () => {
    const rows = leaderboardRows(
      board(10),
      { name: '', score: 3, region: 'FRA' },
      { score: 15, region: 'ITA' },
    )
    expect(rows.filter((r) => r.anonymous)).toHaveLength(1)
  })

  it('keeps the window size, pushing the last named row out', () => {
    const rows = leaderboardRows(
      board(10, 8, 6),
      null,
      { score: 15, region: 'ITA' },
      3,
    )
    expect(rows.map((r) => r.score)).toEqual([15, 10, 8])
    expect(rows.map((r) => r.rank)).toEqual([1, 2, 3])
  })
})

describe('mapBest', () => {
  it('pairs the map best with the region holding it', () => {
    const scores = {
      ...emptyHighScores(),
      byMap: { eu: 15, de: 30 },
      byState: { eu: { FRA: 9, ITA: 15 }, de: { BY: 30 } },
    }
    expect(mapBest(scores, 'eu')).toEqual({ score: 15, region: 'ITA' })
  })

  it('is null before any score on the map', () => {
    expect(mapBest(emptyHighScores(), 'eu')).toBeNull()
  })
})
