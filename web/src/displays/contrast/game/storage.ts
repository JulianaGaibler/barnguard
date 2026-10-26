/**
 * What this display keeps in the browser's storage, namespaced as the other
 * displays are: `bg.<display>.<what>`. Nothing here may throw, since storage
 * that is full or blocked only costs the visitor their saved value.
 */
import { ALGORITHMS, DEFAULT_ALGORITHM, type Algorithm } from './contrast'

export const ALGORITHM_KEY = 'bg.contrast.algorithm'
const HIGH_SCORE_KEY = 'bg.contrast.highscore'

/** The part of the browser's storage this display uses, for a test to stand in. */
export interface SavedStorage {
  getItem(key: string): string | null
  setItem(key: string, value: string): void
}

export function browserStorage(): SavedStorage | null {
  try {
    return window.localStorage
  } catch {
    return null
  }
}

/** One best score per algorithm, since the two do not rate the same pairs. */
export function highScoreKey(algorithm: Algorithm): string {
  return `${HIGH_SCORE_KEY}.${algorithm}`
}

/** The best score saved for `algorithm`, or 0. */
export function loadHighScore(
  algorithm: Algorithm,
  storage: SavedStorage | null = browserStorage(),
): number {
  try {
    const value = Number(storage?.getItem(highScoreKey(algorithm)))
    return Number.isInteger(value) && value > 0 ? value : 0
  } catch {
    return 0
  }
}

/**
 * Saves `score` as the best for `algorithm` when it beats the one saved, and
 * says whether it did. A score of 0 is never a record.
 */
export function saveHighScore(
  algorithm: Algorithm,
  score: number,
  storage: SavedStorage | null = browserStorage(),
): boolean {
  if (score <= loadHighScore(algorithm, storage)) return false
  try {
    storage?.setItem(highScoreKey(algorithm), String(score))
  } catch {
    // The score still counts as a record for this run.
  }
  return true
}

/** The algorithm chosen in the attendant panel, or the default. */
export function loadAlgorithm(
  storage: SavedStorage | null = browserStorage(),
): Algorithm {
  try {
    const value = storage?.getItem(ALGORITHM_KEY)
    return ALGORITHMS.find((a) => a === value) ?? DEFAULT_ALGORITHM
  } catch {
    return DEFAULT_ALGORITHM
  }
}

export function saveAlgorithm(
  algorithm: Algorithm,
  storage: SavedStorage | null = browserStorage(),
): void {
  try {
    storage?.setItem(ALGORITHM_KEY, algorithm)
  } catch {
    // The choice holds until the page reloads.
  }
}
