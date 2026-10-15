import { describe, expect, it } from 'vitest'
import type { LeaderboardEntry } from '@src/core/leaderboard/leaderboardClient'
import { nameSuggestions } from './nameSuggestions'

function entry(name: string, score: number, tsMs: number): LeaderboardEntry {
  return { id: name, tsMs, display: 'enterprise-eu', name, score }
}

const board = [
  entry('leonie', 14, 10),
  entry('lena', 3, 50),
  entry('max', 13, 40),
  entry('leo', 9, 30),
  entry('mia', 4, 20),
]

describe('nameSuggestions', () => {
  it('offers the most recent names when nothing is typed', () => {
    expect(nameSuggestions(board, '')).toEqual(['lena', 'max', 'leo', 'mia'])
  })

  it('offers names starting with what is typed, best first', () => {
    expect(nameSuggestions(board, 'le')).toEqual(['leonie', 'leo', 'lena'])
  })

  it('matches regardless of case and surrounding space', () => {
    expect(nameSuggestions(board, ' LE ')).toEqual(['leonie', 'leo', 'lena'])
  })

  it('leaves out the name already typed in full', () => {
    expect(nameSuggestions(board, 'leo')).toEqual(['leonie'])
  })

  it('caps the list', () => {
    expect(nameSuggestions(board, '', 2)).toEqual(['lena', 'max'])
  })

  it('offers nothing for an unknown prefix or an empty board', () => {
    expect(nameSuggestions(board, 'zz')).toEqual([])
    expect(nameSuggestions([], '')).toEqual([])
  })
})
