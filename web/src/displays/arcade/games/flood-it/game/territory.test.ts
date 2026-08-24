import { describe, expect, it } from 'vitest'
import { seededRandom } from '../../common/rng'
import {
  absorbGains,
  createBoard,
  createMoveResult,
  ownedCount,
  seedOwners,
  unownedCount,
} from './board'
import { bestGain, type DealtBoard } from './generate'
import { fakeClock } from './fakeClock'
import { TerritorySession, type TerritoryEnding } from './territory'
import type { PlayerId } from './types'

function dealOf(rows: string[], numColors: number): DealtBoard {
  const cols = rows[0]!.length
  const board = createBoard(cols, rows.length, numColors)
  rows.forEach((row, r) => {
    for (let c = 0; c < cols; c++) board.color[r * cols + c] = Number(row[c])
  })
  seedOwners(board, 2)
  return { board, par: 0, maxMoves: 0 }
}

/** A contest past its deal-in hold, with player one to move. */
async function openContest(deal?: DealtBoard): Promise<{
  session: TerritorySession
  clock: ReturnType<typeof fakeClock>
}> {
  const clock = fakeClock()
  const session = new TerritorySession({
    host: clock.host,
    preset: 'small',
    random: seededRandom(4),
    deal,
  })
  session.start()
  await clock.advance()
  return { session, clock }
}

describe('opening a contest', () => {
  it('holds through the deal-in, then gives player one the move', async () => {
    const clock = fakeClock()
    const session = new TerritorySession({
      host: clock.host,
      preset: 'small',
      random: seededRandom(4),
    })
    session.start()
    expect(session.state).toBe('dealing')
    expect(session.canPlay(1)).toBe(false)

    await clock.advance()
    expect(session.state).toBe('playing')
    expect(session.turn).toBe(1)
    expect(session.canPlay(1)).toBe(true)
    expect(session.canPlay(2)).toBe(false)
  })

  it('starts both players with a region and open ground between them', async () => {
    const { session } = await openContest()
    expect(session.count(1)).toBeGreaterThan(0)
    expect(session.count(2)).toBeGreaterThan(0)
    expect(unownedCount(session.board)).toBeGreaterThan(0)
  })
})

describe('taking turns', () => {
  it('rejects a move from the player who is not up', async () => {
    const { session } = await openContest()
    const other = session.currentColor(2) === 0 ? 1 : 0
    expect(session.play(2, other)).toBe(false)
    expect(session.turn).toBe(1)
  })

  it('passes the turn once the flood settles, and not before', async () => {
    const { session, clock } = await openContest()
    const turns: PlayerId[] = []
    session.events.on('turnChanged', (p) => turns.push(p))

    const pick = session.currentColor(1) === 0 ? 1 : 0
    expect(session.play(1, pick)).toBe(true)
    // Still settling, so neither player may act.
    expect(session.state).toBe('settling')
    expect(session.canPlay(1)).toBe(false)
    expect(session.canPlay(2)).toBe(false)

    await clock.advance()
    expect(session.turn).toBe(2)
    expect(session.canPlay(2)).toBe(true)
    expect(turns).toEqual([2])
  })

  it('alternates over several turns', async () => {
    const { session, clock } = await openContest()
    const seen: PlayerId[] = [session.turn]
    for (let i = 0; i < 4 && session.state !== 'over'; i++) {
      const player = session.turn
      const current = session.currentColor(player)
      const pick = current === 0 ? 1 : 0
      session.play(player, pick)
      await clock.advance()
      if (session.state === 'playing') seen.push(session.turn)
    }
    for (let i = 1; i < seen.length; i++) {
      expect(seen[i]).not.toBe(seen[i - 1])
    }
  })

  it('rejects the color a region already shows, without costing the turn', async () => {
    const { session } = await openContest()
    expect(session.play(1, session.currentColor(1))).toBe(false)
    expect(session.state).toBe('playing')
    expect(session.turn).toBe(1)
  })

  it('lets a move that takes nothing still cost the turn', async () => {
    // Player one is boxed in by a ring of twos, so flooding to 1 gains nothing.
    // The turn passes anyway: misreading the board is meant to have a price.
    const deal = dealOf(['022', '221', '212'], 3)
    const { session, clock } = await openContest(deal)
    const before = session.count(1)
    expect(session.play(1, 1)).toBe(true)
    await clock.advance()
    expect(session.count(1)).toBe(before)
    expect(session.turn).toBe(2)
  })
})

describe('ending a contest', () => {
  it('ends when the last cell is claimed, and counts the cells', async () => {
    // Two cells, one each. Nothing is left open, so the first settle ends it.
    const deal = dealOf(['01'], 2)
    const { session, clock } = await openContest(deal)
    expect(unownedCount(session.board)).toBe(0)

    let over: { winner: 0 | PlayerId; ending: TerritoryEnding } | null = null
    session.events.on('matchOver', (e) => (over = e))
    session.play(1, 1)
    await clock.advance()
    expect(over).not.toBeNull()
    expect(over!.ending).toBe('boardFull')
    expect(session.state).toBe('over')
  })

  it('awards the open ground when a player is walled in', async () => {
    // Player one holds the corner behind a wall of player two's color. After
    // player two takes the middle row, player one can never reach the rest.
    const board = createBoard(4, 3, 3)
    board.color.set([0, 1, 1, 1, 1, 1, 1, 1, 2, 2, 2, 2])
    board.owner.set([1, 2, 2, 2, 2, 2, 2, 2, 0, 0, 0, 0])
    const deal: DealtBoard = { board, par: 0, maxMoves: 0 }

    const clock = fakeClock()
    const session = new TerritorySession({
      host: clock.host,
      preset: 'small',
      random: seededRandom(1),
      deal,
    })
    session.start()
    await clock.advance()

    let over: {
      winner: 0 | PlayerId
      a: number
      b: number
      ending: TerritoryEnding
    } | null = null
    session.events.on('matchOver', (e) => (over = e))

    // Player one is already sealed off, so their move settles into the ending.
    session.play(1, 1)
    await clock.advance()

    expect(over).not.toBeNull()
    expect(over!.ending).toBe('walledIn')
    expect(over!.winner).toBe(2)
    // The four unclaimed cells go to the only player who could have taken them.
    expect(over!.a + over!.b).toBe(board.color.length)
    expect(over!.b).toBe(board.color.length - over!.a)
  })

  it('accepts no further move once it is over', async () => {
    const { session, clock } = await openContest(dealOf(['01'], 2))
    session.play(1, 1)
    await clock.advance()
    expect(session.state).toBe('over')
    expect(session.play(2, 0)).toBe(false)
  })

  it('finishes when both players take gainful moves, on any deal', async () => {
    for (let seed = 0; seed < 6; seed++) {
      const clock = fakeClock()
      const session = new TerritorySession({
        host: clock.host,
        preset: 'small',
        random: seededRandom(seed + 40),
      })
      session.start()
      await clock.advance()

      const scratch = createBoard(
        session.board.cols,
        session.board.rows,
        session.board.numColors,
      )
      const res = createMoveResult(session.board)
      const gains = new Int32Array(session.board.numColors)

      let guard = 0
      while (session.state !== 'over' && guard++ < 400) {
        const player = session.turn
        absorbGains(session.board, player, scratch, res, gains)
        const pick = bestGain(gains)
        // A player who is not walled in always has a gainful color, so this
        // never has to fall back to a wasted turn.
        expect(pick, `seed ${seed} had no gainful move`).toBeGreaterThanOrEqual(
          0,
        )
        session.play(player, pick)
        await clock.advance()
      }
      expect(session.state, `seed ${seed}`).toBe('over')
      const held = ownedCount(session.board, 1) + ownedCount(session.board, 2)
      expect(held + unownedCount(session.board)).toBe(session.total)
    }
  })
})

describe('redealing', () => {
  it('opens a fresh shared board with player one to move', async () => {
    const { session, clock } = await openContest()
    const first = [...session.board.color]
    session.redeal()
    expect(session.state).toBe('dealing')
    await clock.advance()
    expect(session.state).toBe('playing')
    expect(session.turn).toBe(1)
    expect([...session.board.color]).not.toEqual(first)
  })
})

describe('teardown', () => {
  it('does not pass a turn after being destroyed', async () => {
    const { session, clock } = await openContest()
    const pick = session.currentColor(1) === 0 ? 1 : 0
    session.play(1, pick)
    session.destroy()
    await clock.advance()
    expect(session.state).toBe('settling')
    expect(session.canPlay(2)).toBe(false)
  })
})
