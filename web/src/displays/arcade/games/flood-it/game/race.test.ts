import { describe, expect, it } from 'vitest'
import { seededRandom } from '../../common/rng'
import { fakeClock } from './fakeClock'
import { RaceMatch, resolveRace, type RaceResult } from './race'
import type { PlayerId } from './types'

const flooded = (movesUsed: number, owned = 100): RaceResult => ({
  outcome: 'flooded',
  movesUsed,
  owned,
})
const ranOut = (owned: number, movesUsed = 20): RaceResult => ({
  outcome: 'outOfMoves',
  movesUsed,
  owned,
})

describe('resolveRace', () => {
  it('gives it to whoever flooded, when only one did', () => {
    expect(resolveRace(flooded(19), ranOut(99))).toBe(1)
    expect(resolveRace(ranOut(99), flooded(19))).toBe(2)
  })

  it('prefers the shorter solve between two floods', () => {
    expect(resolveRace(flooded(14), flooded(15))).toBe(1)
    expect(resolveRace(flooded(15), flooded(14))).toBe(2)
  })

  it('ties two floods of equal length', () => {
    expect(resolveRace(flooded(16), flooded(16))).toBe(0)
  })

  it('prefers the larger region when neither flooded', () => {
    expect(resolveRace(ranOut(80), ranOut(60))).toBe(1)
    expect(resolveRace(ranOut(60), ranOut(80))).toBe(2)
  })

  it('ties two failures that got equally far', () => {
    expect(resolveRace(ranOut(70), ranOut(70))).toBe(0)
  })

  it('ignores moves spent when neither flooded', () => {
    // Spending fewer moves is no achievement if the board is unfinished, so the
    // region decides and the counts do not enter into it.
    expect(resolveRace(ranOut(70, 5), ranOut(90, 20))).toBe(2)
  })

  it('ignores the region when both flooded', () => {
    // Both hold the whole board, so their owned counts are equal by definition
    // and only the move count can separate them.
    expect(resolveRace(flooded(12, 100), flooded(13, 100))).toBe(1)
  })
})

/** A match past the deal-in hold on both boards. */
async function openMatch(): Promise<{
  match: RaceMatch
  clock: ReturnType<typeof fakeClock>
}> {
  const clock = fakeClock()
  const match = new RaceMatch(clock.host, 'small', seededRandom(3))
  match.start()
  await clock.advance()
  return { match, clock }
}

/** Play a board to its end, taking the first color that changes anything. */
function playOut(session: RaceMatch['a']): void {
  let guard = 0
  while (!session.finished && guard++ < 200) {
    for (let c = 0; c < session.board.numColors; c++) {
      if (session.play(c)) break
    }
  }
}

describe('RaceMatch', () => {
  it('deals both players the same board', async () => {
    const { match } = await openMatch()
    expect([...match.a.board.color]).toEqual([...match.b.board.color])
    expect(match.a.maxMoves).toBe(match.b.maxMoves)
  })

  it('keeps the two boards independent once play starts', async () => {
    const { match } = await openMatch()
    match.a.play(match.a.currentColor === 0 ? 1 : 0)
    expect([...match.a.board.color]).not.toEqual([...match.b.board.color])
    expect(match.b.movesUsed).toBe(0)
  })

  it('waits for the second player before resolving', async () => {
    const { match } = await openMatch()
    const done: PlayerId[] = []
    let over = false
    match.events.on('playerDone', (e) => done.push(e.player))
    match.events.on('matchOver', () => (over = true))

    playOut(match.a)
    expect(done).toEqual([1])
    expect(over).toBe(false)

    playOut(match.b)
    expect(done).toEqual([1, 2])
    expect(over).toBe(true)
    expect(match.over).toBe(true)
  })

  it('resolves the same way the pure rule does', async () => {
    const { match } = await openMatch()
    let seen: { winner: 0 | PlayerId; a: RaceResult; b: RaceResult } | null =
      null
    match.events.on('matchOver', (e) => (seen = e))
    playOut(match.a)
    playOut(match.b)
    expect(seen).not.toBeNull()
    const e = seen!
    expect(e.winner).toBe(resolveRace(e.a, e.b))
  })

  it('announces the match over exactly once', async () => {
    const { match } = await openMatch()
    let count = 0
    match.events.on('matchOver', () => count++)
    playOut(match.a)
    playOut(match.b)
    // Both boards are finished, so any further tap must be inert.
    match.a.play(0)
    match.b.play(0)
    expect(count).toBe(1)
  })

  it('deals a fresh identical pair on a redeal', async () => {
    const { match, clock } = await openMatch()
    const first = [...match.a.board.color]
    playOut(match.a)
    playOut(match.b)

    match.redeal('small', seededRandom(9))
    await clock.advance()
    expect(match.over).toBe(false)
    expect(match.a.movesUsed).toBe(0)
    expect([...match.a.board.color]).toEqual([...match.b.board.color])
    expect([...match.a.board.color]).not.toEqual(first)
  })

  it('hands out the session for each side', async () => {
    const { match } = await openMatch()
    expect(match.session(1)).toBe(match.a)
    expect(match.session(2)).toBe(match.b)
  })
})
