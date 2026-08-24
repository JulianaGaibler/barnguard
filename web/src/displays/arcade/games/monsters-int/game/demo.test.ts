import { describe, expect, it } from 'vitest'
import { MONSTERS_INT_TUTORIAL } from '../tutorial'
import { faceOf, buildDeck, type Card } from './rules/cards'
import { createPlayer, scorePlayer } from './rules/player'
import { freeze, life, n, plus, threeMore, x2 } from './rules/scriptedDeck'

// The scenes themselves need a GPU stage, so what is checkable here is that
// every card the tutorial reaches for exists in the deck and has artwork, and
// that the numbers its copy quotes are the numbers the game would work out.

/** Every card face the tutorial scenes put on screen. */
const SHOWN: Card[] = [
  ...[0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 11, 12].map(n),
  plus(6),
  x2,
  freeze,
  threeMore,
  life,
]

describe('the cards the tutorial shows', () => {
  it('are all cards the real deck holds', () => {
    const real = new Set(buildDeck().map((c) => faceOf(c.card)))
    for (const card of SHOWN) {
      expect(real.has(faceOf(card)), faceOf(card)).toBe(true)
    }
  })
})

describe('the scoring a card claims', () => {
  /** What the table would say a hand of these is worth. */
  const worth = (cards: Card[]): number => {
    const player = createPlayer(0)
    cards.forEach((card, i) => {
      const held = { id: `t${i}`, card }
      if (card.kind === 'number') player.numbers.push(held)
      else player.modifiers.push(held)
    })
    return scorePlayer(player).total
  }

  it('adds the numbers up, which is what the goal card shows', () => {
    expect(worth([n(3), n(9), n(11)])).toBe(23)
  })

  // The bonus card's copy says the doubler applies to the numbers and the plus
  // is added after. If that order ever flips, the copy is wrong.
  it('doubles the numbers before adding a plus', () => {
    expect(worth([n(5), n(8), plus(6), x2])).toBe((5 + 8) * 2 + 6)
  })

  it('pays the seven bonus on top, which is what that card promises', () => {
    const player = createPlayer(0)
    ;[4, 9, 1, 11, 6, 2, 8].forEach((value, i) => {
      player.numbers.push({ id: `s${i}`, card: n(value) })
    })
    player.status = 'hasSeven'
    expect(scorePlayer(player).sevenBonus).toBe(15)
  })
})

describe('the tutorial itself', () => {
  it('gives every card copy and a scene', () => {
    expect(MONSTERS_INT_TUTORIAL.length).toBeGreaterThan(0)
    for (const card of MONSTERS_INT_TUTORIAL) {
      expect(card.title.length, card.title).toBeGreaterThan(0)
      expect(card.body.length, card.title).toBeGreaterThan(0)
      expect(typeof card.build, card.title).toBe('function')
    }
  })

  it("uses each scene once, so no card shows another one's demo", () => {
    const builds = MONSTERS_INT_TUTORIAL.map((c) => c.build)
    expect(new Set(builds).size).toBe(builds.length)
  })
})
