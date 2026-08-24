import { describe, expect, it } from 'vitest'
import { buildDeck, DECK_SIZE, faceOf, MAX_NUMBER, type Card } from './cards'
import { createDeck, drawCard, discardCards, type DeckState } from './deck'
import {
  canStay,
  createPlayer,
  SEVEN_BONUS,
  scorePlayer,
  type PlayerState,
} from './player'
import {
  applyRoundScores,
  createMatch,
  endMatch,
  standings,
  TARGET_SCORE,
} from './match'
import { n, plus, x2, life, fixedRandom } from './scriptedDeck'

/** A player holding these cards, for the scoring cases. */
function holding(cards: Card[], status: PlayerState['status'] = 'stayed') {
  const p = createPlayer(0)
  p.status = status
  cards.forEach((card, i) => {
    const entry = { id: `c${i}`, card }
    if (card.kind === 'number') p.numbers.push(entry)
    else p.modifiers.push(entry)
  })
  return p
}

describe('the deck', () => {
  it('holds 94 cards', () => {
    expect(buildDeck()).toHaveLength(DECK_SIZE)
  })

  it('has one zero, and n copies of every other number', () => {
    const deck = buildDeck()
    const counts = new Map<number, number>()
    for (const { card } of deck) {
      if (card.kind === 'number') {
        counts.set(card.value, (counts.get(card.value) ?? 0) + 1)
      }
    }
    expect(counts.get(0)).toBe(1)
    for (let v = 1; v <= MAX_NUMBER; v++) expect(counts.get(v), `${v}`).toBe(v)
  })

  it('holds one of each modifier and three of each action', () => {
    const kinds = new Map<string, number>()
    for (const { card } of buildDeck()) {
      const key = card.kind === 'plus' ? `plus${card.amount}` : card.kind
      kinds.set(key, (kinds.get(key) ?? 0) + 1)
    }
    for (const k of ['plus2', 'plus4', 'plus6', 'plus8', 'plus10', 'times2']) {
      expect(kinds.get(k), k).toBe(1)
    }
    for (const k of ['freeze', 'threeMore', 'extraLife']) {
      expect(kinds.get(k), k).toBe(3)
    }
  })

  it('gives every physical card its own id', () => {
    const ids = buildDeck().map((c) => c.id)
    expect(new Set(ids).size).toBe(ids.length)
  })

  it('names an artwork file for every card', () => {
    for (const { card } of buildDeck()) {
      expect(faceOf(card), JSON.stringify(card)).toMatch(
        /^(card-\d\d|bonus-plus-\d+|bonus-times-two|action-(3more|freeze|life))$/,
      )
    }
  })

  it('shuffles deterministically from a seed', () => {
    const a = createDeck(seeded(7)).draw.map((c) => c.id)
    const b = createDeck(seeded(7)).draw.map((c) => c.id)
    const c = createDeck(seeded(8)).draw.map((c) => c.id)
    expect(a).toEqual(b)
    expect(a).not.toEqual(c)
  })
})

function seeded(seed: number): () => number {
  let s = seed >>> 0
  return () => {
    s = (s * 1664525 + 1013904223) >>> 0
    return s / 2 ** 32
  }
}

describe('drawing', () => {
  const deckOf = (draw: Card[]): DeckState => ({
    draw: draw.map((card, i) => ({ id: `d${i}`, card })),
    discard: [],
  })

  it('takes from the top', () => {
    const deck = deckOf([n(1), n(2)])
    expect(drawCard(deck, fixedRandom)?.card).toEqual(n(2))
  })

  it('reshuffles the discards only once the draw pile is out', () => {
    const deck = deckOf([n(1)])
    discardCards(deck, [{ id: 'x', card: n(9) }])
    expect(drawCard(deck, fixedRandom)?.card).toEqual(n(1))
    expect(deck.discard).toHaveLength(1)
    expect(drawCard(deck, fixedRandom)?.card).toEqual(n(9))
    expect(deck.discard).toHaveLength(0)
  })

  it('returns null only when both piles are empty', () => {
    const deck = deckOf([])
    expect(drawCard(deck, fixedRandom)).toBeNull()
  })
})

describe('scoring a round', () => {
  it('sums the number cards', () => {
    expect(scorePlayer(holding([n(11), n(5), n(12)])).total).toBe(28)
  })

  it('adds a plus modifier after the sum', () => {
    expect(scorePlayer(holding([n(11), n(5), n(12), plus(4)])).total).toBe(32)
  })

  it('doubles the numbers BEFORE adding the pluses', () => {
    // 10 doubled is 20, then +10 is 30. Doubling the total would give 40.
    const score = scorePlayer(holding([n(10), x2, plus(10)]))
    expect(score.total).toBe(30)
    expect(score.doubled).toBe(true)
  })

  it('scores nothing for a lone multiplier', () => {
    expect(scorePlayer(holding([x2])).total).toBe(0)
  })

  it('still scores a lone plus, which needs no numbers', () => {
    expect(scorePlayer(holding([plus(8)])).total).toBe(8)
  })

  it('counts the zero toward seven without adding to the sum', () => {
    const p = holding([n(0), n(1), n(2), n(3), n(4), n(5), n(6)], 'hasSeven')
    const score = scorePlayer(p)
    expect(score.numberSum).toBe(21)
    expect(score.sevenBonus).toBe(SEVEN_BONUS)
    expect(score.total).toBe(36)
  })

  it('gives the bonus only to a player who actually reached seven', () => {
    expect(scorePlayer(holding([n(1), n(2)])).sevenBonus).toBe(0)
  })

  it('scores a busted player zero, however good their cards were', () => {
    const p = holding([n(12), n(11), n(10), x2, plus(10)], 'busted')
    expect(scorePlayer(p).total).toBe(0)
  })
})

describe('staying', () => {
  it('needs at least one card', () => {
    const empty = createPlayer(0)
    expect(canStay(empty)).toBe(false)
    empty.modifiers.push({ id: 'm', card: plus(2) })
    expect(canStay(empty)).toBe(true)
  })

  it('counts a held life as something to stay on', () => {
    const p = createPlayer(0)
    p.life = { id: 'l', card: life }
    expect(canStay(p)).toBe(true)
  })

  it('is not available to a player already out', () => {
    const p = holding([n(4)], 'busted')
    expect(canStay(p)).toBe(false)
  })
})

describe('the match', () => {
  const score = (seat: number, total: number) => ({
    seat,
    numberSum: total,
    doubled: false,
    plusTotal: 0,
    sevenBonus: 0,
    total,
  })

  it('accumulates totals across rounds', () => {
    const match = createMatch(2, 1)
    applyRoundScores(match, [score(0, 40), score(1, 30)])
    applyRoundScores(match, [score(0, 20), score(1, 10)])
    expect(match.totals).toEqual([60, 40])
    expect(match.round).toBe(2)
    expect(match.over).toBe(false)
  })

  it('ends once someone reaches the target', () => {
    const match = createMatch(2, 1)
    applyRoundScores(match, [score(0, TARGET_SCORE), score(1, 10)])
    expect(match.over).toBe(true)
    expect(match.winners).toEqual([0])
  })

  it('declares every tied leader a winner', () => {
    const match = createMatch(3, 1)
    applyRoundScores(match, [
      score(0, TARGET_SCORE),
      score(1, TARGET_SCORE),
      score(2, 10),
    ])
    expect(match.winners).toEqual([0, 1])
  })

  it('does not end on a high score short of the target', () => {
    const match = createMatch(2, 1)
    applyRoundScores(match, [score(0, TARGET_SCORE - 1), score(1, 0)])
    expect(match.over).toBe(false)
  })

  // The booth is played standing up and a game to 200 can outlast the people
  // playing it, so the table can stop and still get a winner.
  it('settles on whoever is ahead when the table calls it early', () => {
    const match = createMatch(3, 1)
    applyRoundScores(match, [score(0, 30), score(1, 70), score(2, 70)])
    expect(match.over).toBe(false)
    endMatch(match)
    expect(match.over).toBe(true)
    expect(match.winners).toEqual([1, 2])
  })

  it('ranks standings high to low, sharing a rank on a tie', () => {
    const match = createMatch(4, 1)
    applyRoundScores(match, [
      score(0, 30),
      score(1, 50),
      score(2, 50),
      score(3, 10),
    ])
    expect(standings(match)).toEqual([
      { seat: 1, total: 50, rank: 1 },
      { seat: 2, total: 50, rank: 1 },
      { seat: 0, total: 30, rank: 3 },
      { seat: 3, total: 10, rank: 4 },
    ])
  })

  it('replays identically from a seed', () => {
    const a = createMatch(2, 42)
    const b = createMatch(2, 42)
    const rolls = (m: ReturnType<typeof createMatch>) =>
      Array.from({ length: 5 }, () => {
        m.rngState = (m.rngState * 1664525 + 1013904223) >>> 0
        return m.rngState
      })
    expect(rolls(a)).toEqual(rolls(b))
  })
})
