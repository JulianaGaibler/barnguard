import { describe, expect, it } from 'vitest'
import { devJumpFrom, driveTo } from './devJump'
import { Session } from '../game/session'
import { seededRandom } from '../game/round'
import { unpackColors } from '../game/colors'
import { PACKED_COLORS } from '../game/colorList'

function session(): Session {
  return new Session({
    algorithm: 'apca',
    colors: unpackColors(PACKED_COLORS),
    random: seededRandom(5),
    storage: null,
  })
}

describe('devJumpFrom', () => {
  it('asks for nothing without a screen or a seed', () => {
    expect(devJumpFrom('')).toBeNull()
    expect(devJumpFrom('?display=contrast&screen=nope')).toBeNull()
  })

  it('reads the screen, the rounds and the seed', () => {
    const jump = devJumpFrom('?screen=gameover&rounds=3&seed=7')
    expect(jump?.screen).toBe('gameover')
    expect(jump?.rounds).toBe(3)
    expect(jump?.random).toBeTypeOf('function')
  })

  it('takes a seed alone as a jump to the splash', () => {
    expect(devJumpFrom('?seed=1')?.screen).toBe('splash')
  })
})

describe('driveTo', () => {
  it('stops at the splash', () => {
    const s = session()
    driveTo(s, { screen: 'splash', rounds: 0, random: undefined })
    expect(s.phase).toBe('splash')
  })

  it('plays to a round in play', () => {
    const s = session()
    driveTo(s, { screen: 'playing', rounds: 0, random: undefined })
    s.beginRound()
    expect(s.phase).toBe('playing')
    expect(s.results).toHaveLength(0)
  })

  it('answers right for the rounds asked, then stops at the reveal', () => {
    const s = session()
    driveTo(s, { screen: 'reveal', rounds: 2, random: undefined })
    s.beginRound()
    expect(s.phase).toBe('reveal')
    s.finishReveal()
    s.beginRound()
    expect(s.phase).toBe('reveal')
    s.finishReveal()
    s.beginRound()
    expect(s.results).toHaveLength(3)
    expect(s.score).toBe(3)
  })

  it('misses on purpose to reach the game over', () => {
    const s = session()
    driveTo(s, { screen: 'gameover', rounds: 1, random: undefined })
    s.beginRound()
    s.finishReveal()
    s.beginRound()
    s.finishReveal()
    expect(s.phase).toBe('gameover')
    expect(s.score).toBe(1)
  })
})
