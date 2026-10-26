import { describe, expect, it } from 'vitest'
import type { Rgb } from './contrast'
import { ROUND_SECONDS, Session } from './session'
import { seededRandom } from './round'
import { highScoreKey, loadHighScore, type SavedStorage } from './storage'
import { PACKED_COLORS } from './colorList'
import { unpackColors } from './colors'

const COLORS: readonly Rgb[] = unpackColors(PACKED_COLORS)

function storage(initial: Record<string, string> = {}): SavedStorage {
  const data = { ...initial }
  return {
    getItem: (key) => data[key] ?? null,
    setItem: (key, value) => {
      data[key] = value
    },
  }
}

function session(store: SavedStorage = storage()): Session {
  return new Session({
    algorithm: 'apca',
    colors: COLORS,
    random: seededRandom(3),
    storage: store,
  })
}

/** Plays one round to the reveal, answering right or wrong. */
function play(s: Session, right: boolean): void {
  s.beginRound()
  const level = s.round!.level
  s.vote(right ? level : level === 1 ? 2 : 1)
}

describe('Session', () => {
  it('starts on the splash', () => {
    expect(session().phase).toBe('splash')
  })

  it('walks a round through entering, playing and reveal', () => {
    const s = session()
    s.start()
    expect(s.phase).toBe('entering')
    expect(s.round).not.toBeNull()
    s.vote(1)
    expect(s.phase).toBe('entering')
    s.beginRound()
    expect(s.phase).toBe('playing')
    s.vote(s.round!.level)
    expect(s.phase).toBe('reveal')
    expect(s.score).toBe(1)
  })

  it('goes on to a new card after a right answer', () => {
    const s = session()
    s.start()
    const first = s.round
    play(s, true)
    s.finishReveal()
    expect(s.phase).toBe('entering')
    expect(s.round).not.toBe(first)
    expect(s.remaining).toBe(ROUND_SECONDS)
  })

  it('has the next card ready once an answer is right, and not after a wrong one', () => {
    const s = session()
    s.start()
    s.beginRound()
    expect(s.upcoming).toBeNull()
    s.vote(s.round!.level)
    const next = s.upcoming
    expect(next).not.toBeNull()
    s.finishReveal()
    expect(s.round).toBe(next)
    expect(s.upcoming).toBeNull()
    play(s, false)
    expect(s.upcoming).toBeNull()
  })

  it('ends the run on a wrong answer', () => {
    const s = session()
    s.start()
    play(s, true)
    s.finishReveal()
    play(s, false)
    expect(s.phase).toBe('reveal')
    s.finishReveal()
    expect(s.phase).toBe('gameover')
    expect(s.score).toBe(1)
    expect(s.last?.correct).toBe(false)
  })

  it('ends the run when the clock runs out, with no pick', () => {
    const s = session()
    s.start()
    s.beginRound()
    s.tick(ROUND_SECONDS - 1)
    expect(s.phase).toBe('playing')
    expect(s.remaining).toBeCloseTo(1)
    s.tick(2)
    expect(s.phase).toBe('reveal')
    expect(s.last?.pick).toBeNull()
    expect(s.last?.correct).toBe(false)
    s.finishReveal()
    expect(s.phase).toBe('gameover')
  })

  it('does not run the clock outside a round', () => {
    const s = session()
    s.start()
    s.tick(100)
    expect(s.phase).toBe('entering')
    expect(s.remaining).toBe(ROUND_SECONDS)
  })

  it('saves a record and reports it', () => {
    const store = storage()
    const s = session(store)
    s.start()
    play(s, true)
    s.finishReveal()
    play(s, true)
    s.finishReveal()
    play(s, false)
    s.finishReveal()
    expect(s.record).toBe(true)
    expect(s.best).toBe(2)
    expect(loadHighScore('apca', store)).toBe(2)
  })

  it('shows the old best when the run does not beat it', () => {
    const store = storage({ [highScoreKey('apca')]: '8' })
    const s = session(store)
    s.start()
    play(s, true)
    s.finishReveal()
    play(s, false)
    s.finishReveal()
    expect(s.record).toBe(false)
    expect(s.best).toBe(8)
    expect(loadHighScore('apca', store)).toBe(8)
  })

  it('starts a fresh run from a game over', () => {
    const s = session()
    s.start()
    play(s, false)
    s.finishReveal()
    s.start()
    expect(s.phase).toBe('entering')
    expect(s.results).toEqual([])
    expect(s.score).toBe(0)
  })

  it('goes back to the splash on reset and on an algorithm change', () => {
    const s = session()
    s.start()
    play(s, true)
    s.reset()
    expect(s.phase).toBe('splash')
    expect(s.results).toEqual([])
    s.start()
    s.setAlgorithm('wcag')
    expect(s.phase).toBe('splash')
    expect(s.algorithm).toBe('wcag')
  })

  it('tells subscribers about every change', () => {
    const s = session()
    let calls = 0
    const stop = s.subscribe(() => calls++)
    s.start()
    s.beginRound()
    expect(calls).toBe(2)
    stop()
    s.reset()
    expect(calls).toBe(2)
  })
})
