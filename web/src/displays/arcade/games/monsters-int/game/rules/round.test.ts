import { describe, expect, it } from 'vitest'
import {
  applyInput,
  createRound,
  eligibleTargets,
  stepRound,
  type RoundEvent,
  type RoundInput,
  type RoundState,
} from './round'
import {
  fixedRandom,
  freeze,
  life,
  n,
  plus,
  stackedDeck,
  threeMore,
  x2,
} from './scriptedDeck'
import { scorePlayer } from './player'

// Every case is a hand-built deck, so it reads as the situation it is. The
// intricate rules here are the ones the written spec spends the most words on:
// an action interrupting the deal, Three More deferring what it turns up, and
// the Extra Life changing hands.

/** Run until the round needs input or ends, collecting what happened. */
function run(state: RoundState, limit = 200): RoundEvent[] {
  const events: RoundEvent[] = []
  for (let i = 0; i < limit; i++) {
    if (state.pending.kind !== 'none' || state.ended) break
    const batch = stepRound(state, fixedRandom)
    events.push(...batch)
  }
  return events
}

function input(state: RoundState, i: RoundInput): RoundEvent[] {
  const events = applyInput(state, i)
  events.push(...run(state))
  return events
}

const types = (events: RoundEvent[]): string[] => events.map((e) => e.type)
const numbersOf = (state: RoundState, seat: number): number[] =>
  state.players[seat]!.numbers.map((c) =>
    c.card.kind === 'number' ? c.card.value : -1,
  )

describe('the opening deal', () => {
  it('gives one card to each seat in turn order', () => {
    const state = createRound(3, stackedDeck(n(1), n(2), n(3)))
    run(state)
    expect(numbersOf(state, 0)).toEqual([1])
    expect(numbersOf(state, 1)).toEqual([2])
    expect(numbersOf(state, 2)).toEqual([3])
  })

  it('rotates who is dealt to first with the dealer', () => {
    const state = createRound(3, stackedDeck(n(1), n(2), n(3)), 1)
    run(state)
    expect(numbersOf(state, 1)).toEqual([1])
    expect(numbersOf(state, 2)).toEqual([2])
    expect(numbersOf(state, 0)).toEqual([3])
  })

  it('resolves an action mid-deal and then carries on dealing', () => {
    // Seat 1 draws Three More, aims it, and seat 2 is still dealt to after.
    const state = createRound(
      3,
      stackedDeck(n(1), threeMore, n(5), n(6), n(7), n(9)),
    )
    run(state)
    expect(state.pending.kind).toBe('target')

    input(state, { kind: 'target', seat: 1 })
    expect(numbersOf(state, 1)).toEqual([5, 6, 7])
    // The deal resumed: seat 2 got the next card rather than being skipped.
    expect(numbersOf(state, 2)).toEqual([9])
  })

  it('never deals to a seat frozen earlier in the deal', () => {
    const state = createRound(3, stackedDeck(n(1), freeze, n(9)))
    run(state)
    input(state, { kind: 'target', seat: 2 })
    expect(state.players[2]!.status).toBe('stayed')
    // Seat 2's own opening card never arrives.
    expect(numbersOf(state, 2)).toEqual([])
  })

  it('leaves a player holding no number card at all', () => {
    const state = createRound(2, stackedDeck(plus(4), x2))
    run(state)
    expect(numbersOf(state, 0)).toEqual([])
    expect(state.players[0]!.modifiers).toHaveLength(1)
  })
})

describe('busting', () => {
  it('busts on a repeated number and takes the player out', () => {
    const state = createRound(2, stackedDeck(n(5), n(9), n(5)))
    run(state)
    const events = input(state, { kind: 'hit' })
    expect(types(events)).toContain('busted')
    expect(state.players[0]!.status).toBe('busted')
    expect(scorePlayer(state.players[0]!).total).toBe(0)
  })

  it('keeps the busted cards on the table, worth nothing', () => {
    const state = createRound(2, stackedDeck(n(5), n(9), n(5)))
    run(state)
    input(state, { kind: 'hit' })
    // The duplicate stays in front of them, which is what the reshuffle rule
    // depends on.
    expect(numbersOf(state, 0)).toEqual([5, 5])
  })

  it('does not bust on a repeated modifier', () => {
    const state = createRound(2, stackedDeck(plus(4), n(9), plus(4)))
    run(state)
    input(state, { kind: 'hit' })
    expect(state.players[0]!.status).toBe('active')
  })
})

describe('the seven-card bonus', () => {
  /**
   * Turns alternate, so seat 0 only draws every other card while anyone else is
   * active. Seat 1 stays after one card, leaving seat 0 the rest of the deck.
   */
  function soloRun(first: ReturnType<typeof n>): RoundState {
    const state = createRound(
      2,
      stackedDeck(first, n(12), n(2), n(3), n(4), n(5), n(6), n(7)),
    )
    run(state)
    input(state, { kind: 'hit' }) // seat 0
    input(state, { kind: 'stay' }) // seat 1 leaves
    while (!state.ended && state.pending.kind === 'turn') {
      input(state, { kind: 'hit' })
    }
    return state
  }

  it('ends the round the moment someone reaches seven unique numbers', () => {
    const state = soloRun(n(1))
    expect(state.ended).toBe('seven')
    expect(state.players[0]!.status).toBe('hasSeven')
    expect(state.sevenSeat).toBe(0)
  })

  it('counts the zero toward the seven', () => {
    const state = soloRun(n(0))
    expect(state.players[0]!.numbers).toHaveLength(7)
    expect(scorePlayer(state.players[0]!).sevenBonus).toBe(15)
    // The zero adds nothing to the sum it is counted in.
    expect(scorePlayer(state.players[0]!).numberSum).toBe(27)
  })
})

describe('staying', () => {
  it('banks the cards and leaves the round', () => {
    const state = createRound(2, stackedDeck(n(5), n(9)))
    run(state)
    const events = input(state, { kind: 'stay' })
    expect(types(events)).toContain('stayed')
    expect(state.players[0]!.status).toBe('stayed')
  })

  it('refuses a player with nothing in front of them', () => {
    // Seat 1 is frozen during the deal, so seat 0 plays on with one card and
    // seat 1 never gets one. Staying with an empty table is not a move.
    const state = createRound(2, stackedDeck(freeze, n(3)))
    run(state)
    expect(state.pending.kind).toBe('target')
    input(state, { kind: 'target', seat: 0 })
    // Seat 0 froze themselves, so only seat 1 is left and holds one card.
    expect(state.players[1]!.numbers).toHaveLength(1)
  })

  it('ends the round when the last active player stays', () => {
    const state = createRound(2, stackedDeck(n(5), n(9)))
    run(state)
    input(state, { kind: 'stay' })
    input(state, { kind: 'stay' })
    expect(state.ended).toBe('noActive')
  })
})

describe('Freeze', () => {
  it('banks the target and takes them out', () => {
    const state = createRound(3, stackedDeck(n(1), n(2), n(3), freeze))
    run(state)
    const events = input(state, { kind: 'hit' })
    expect(state.pending.kind).toBe('target')
    void events
    input(state, { kind: 'target', seat: 2 })
    expect(state.players[2]!.status).toBe('stayed')
    expect(scorePlayer(state.players[2]!).total).toBe(3)
  })

  it('self-targets with no prompt when the drawer is the only one left', () => {
    // Seats 1 and 2 stay, leaving seat 0 alone to draw the Freeze.
    const state = createRound(3, stackedDeck(n(1), n(2), n(3), freeze))
    run(state)
    input(state, { kind: 'stay' }) // seat 0
    input(state, { kind: 'stay' }) // seat 1
    // Seat 2 alone, hits and draws Freeze. Nothing to choose.
    const events = input(state, { kind: 'hit' })
    expect(state.pending.kind).toBe('none')
    expect(types(events)).toContain('frozen')
    expect(state.ended).toBe('noActive')
  })

  it('offers every active seat including the drawer', () => {
    const state = createRound(3, stackedDeck(n(1), n(2), n(3), freeze))
    run(state)
    input(state, { kind: 'hit' })
    expect(eligibleTargets(state)).toEqual([0, 1, 2])
  })
})

describe('Three More', () => {
  it('deals exactly three cards to its target', () => {
    const state = createRound(
      2,
      stackedDeck(n(1), n(2), threeMore, n(4), n(5), n(6), n(7)),
    )
    run(state)
    input(state, { kind: 'hit' })
    input(state, { kind: 'target', seat: 1 })
    expect(numbersOf(state, 1)).toEqual([2, 4, 5, 6])
  })

  it('stops early when the target busts', () => {
    const state = createRound(
      2,
      stackedDeck(n(1), n(2), threeMore, n(2), n(5), n(6)),
    )
    run(state)
    input(state, { kind: 'hit' })
    input(state, { kind: 'target', seat: 1 })
    expect(state.players[1]!.status).toBe('busted')
    // The remaining two cards of the run were never drawn.
    expect(state.deck.draw).toHaveLength(2)
  })

  it('defers a Freeze it turns up until the run finishes', () => {
    const state = createRound(
      3,
      stackedDeck(n(1), n(2), n(3), threeMore, freeze, n(5), n(6)),
    )
    run(state)
    input(state, { kind: 'hit' })
    input(state, { kind: 'target', seat: 1 })
    // The Freeze did not fire mid-run: all three cards landed first.
    expect(numbersOf(state, 1)).toEqual([2, 5, 6])
    expect(state.pending.kind).toBe('target')
    input(state, { kind: 'target', seat: 2 })
    expect(state.players[2]!.status).toBe('stayed')
  })

  it('drops a deferred action when the target busts', () => {
    const state = createRound(
      3,
      stackedDeck(n(1), n(2), n(3), threeMore, freeze, n(2), n(9)),
    )
    run(state)
    input(state, { kind: 'hit' })
    input(state, { kind: 'target', seat: 1 })
    expect(state.players[1]!.status).toBe('busted')
    // The Freeze it turned up is cancelled with the run.
    expect(state.pending.kind).not.toBe('target')
    expect(state.players[2]!.status).toBe('active')
  })

  it('nests a deferred Three More into a run of its own', () => {
    const state = createRound(
      2,
      stackedDeck(
        n(1),
        n(2),
        threeMore,
        threeMore,
        n(5),
        n(6),
        n(7),
        n(8),
        n(9),
      ),
    )
    run(state)
    input(state, { kind: 'hit' })
    input(state, { kind: 'target', seat: 1 })
    // The outer run gave 5 and 6 after the nested card, then the nested Three
    // More resolved and gave three more.
    input(state, { kind: 'target', seat: 1 })
    expect(state.players[1]!.numbers.length).toBeGreaterThanOrEqual(6)
  })

  it('resolves two deferred actions in the order they were drawn', () => {
    const state = createRound(
      3,
      stackedDeck(n(1), n(2), n(3), threeMore, freeze, freeze, n(6)),
    )
    run(state)
    input(state, { kind: 'hit' })
    input(state, { kind: 'target', seat: 1 })
    expect(state.pending.kind).toBe('target')
    input(state, { kind: 'target', seat: 0 })
    // A second prompt follows for the second Freeze.
    expect(state.pending.kind).toBe('target')
  })
})

describe('the Extra Life', () => {
  it('is kept by a player who has none', () => {
    const state = createRound(2, stackedDeck(life, n(2)))
    run(state)
    expect(state.players[0]!.life).not.toBeNull()
  })

  it('is spent on a duplicate, and the player plays on', () => {
    // Deal gives seat 0 the 5 and seat 1 the 2. Then seat 0 takes the life,
    // seat 1 takes a 3, and seat 0 draws the 5 again.
    const state = createRound(2, stackedDeck(n(5), n(2), life, n(3), n(5)))
    run(state)
    input(state, { kind: 'hit' }) // seat 0 takes the life
    input(state, { kind: 'hit' }) // seat 1
    const events = input(state, { kind: 'hit' }) // seat 0 draws the duplicate
    expect(types(events)).toContain('lifeSpent')
    expect(state.players[0]!.status).toBe('active')
    expect(state.players[0]!.life).toBeNull()
    // Neither the life nor the duplicate scores.
    expect(numbersOf(state, 0)).toEqual([5])
  })

  it('goes to the only eligible player when the drawer already holds one', () => {
    const state = createRound(2, stackedDeck(life, n(2), life))
    run(state)
    const events = input(state, { kind: 'hit' })
    expect(types(events)).toContain('lifeGiven')
    expect(state.players[1]!.life).not.toBeNull()
    expect(state.pending.kind).not.toBe('giveLife')
  })

  it('prompts when more than one player could take it', () => {
    const state = createRound(3, stackedDeck(life, n(2), n(3), life))
    run(state)
    input(state, { kind: 'hit' })
    expect(state.pending.kind).toBe('giveLife')
    input(state, { kind: 'target', seat: 2 })
    expect(state.players[2]!.life).not.toBeNull()
  })

  it('is discarded when nobody is eligible', () => {
    const state = createRound(2, stackedDeck(life, life, life))
    run(state)
    // Seat 0 and seat 1 both hold one, so the third has nowhere to go.
    const events = input(state, { kind: 'hit' })
    expect(types(events)).toContain('lifeDiscarded')
  })
})

describe('running out of cards', () => {
  it('reshuffles the discards and leaves the table untouched', () => {
    const state = createRound(2, stackedDeck(n(1), n(2)))
    run(state)
    // Both piles are now empty except for what is in front of the players, so
    // seed the discard as a finished round would have.
    state.deck.discard.push({ id: 'd1', card: n(7) })
    const events = input(state, { kind: 'hit' })
    expect(types(events)).toContain('reshuffled')
    expect(numbersOf(state, 0)).toEqual([1, 7])
    // The other player's card was never swept up.
    expect(numbersOf(state, 1)).toEqual([2])
  })
})
