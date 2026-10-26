import { describe, expect, it } from 'vitest'
import {
  ALGORITHM_KEY,
  highScoreKey,
  loadAlgorithm,
  loadHighScore,
  saveAlgorithm,
  saveHighScore,
  type SavedStorage,
} from './storage'

function fakeStorage(initial: Record<string, string> = {}): SavedStorage & {
  data: Record<string, string>
} {
  const data = { ...initial }
  return {
    data,
    getItem: (key) => data[key] ?? null,
    setItem: (key, value) => {
      data[key] = value
    },
  }
}

describe('high scores', () => {
  it('are namespaced and kept per algorithm', () => {
    expect(highScoreKey('apca')).toBe('bg.contrast.highscore.apca')
    expect(highScoreKey('wcag')).toBe('bg.contrast.highscore.wcag')
  })

  it('save only when they beat the best', () => {
    const storage = fakeStorage()
    expect(saveHighScore('apca', 4, storage)).toBe(true)
    expect(saveHighScore('apca', 4, storage)).toBe(false)
    expect(saveHighScore('apca', 2, storage)).toBe(false)
    expect(loadHighScore('apca', storage)).toBe(4)
    expect(loadHighScore('wcag', storage)).toBe(0)
  })

  it('never count 0 as a record', () => {
    expect(saveHighScore('apca', 0, fakeStorage())).toBe(false)
  })

  it('read a corrupted value as 0', () => {
    for (const bad of ['abc', '-3', '2.5', '']) {
      const storage = fakeStorage({ [highScoreKey('apca')]: bad })
      expect(loadHighScore('apca', storage)).toBe(0)
    }
  })

  it('survive missing or throwing storage', () => {
    const broken: SavedStorage = {
      getItem: () => {
        throw new Error('blocked')
      },
      setItem: () => {
        throw new Error('full')
      },
    }
    expect(loadHighScore('apca', null)).toBe(0)
    expect(loadHighScore('apca', broken)).toBe(0)
    expect(saveHighScore('apca', 3, broken)).toBe(true)
  })
})

describe('the algorithm choice', () => {
  it('defaults to APCA', () => {
    expect(loadAlgorithm(fakeStorage())).toBe('apca')
    expect(loadAlgorithm(null)).toBe('apca')
  })

  it('round trips', () => {
    const storage = fakeStorage()
    saveAlgorithm('wcag', storage)
    expect(storage.data[ALGORITHM_KEY]).toBe('wcag')
    expect(loadAlgorithm(storage)).toBe('wcag')
  })

  it('ignores an unknown value', () => {
    expect(loadAlgorithm(fakeStorage({ [ALGORITHM_KEY]: 'wcag3' }))).toBe(
      'apca',
    )
  })
})
