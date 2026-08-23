import { describe, expect, it } from 'vitest'
import { seededRandom } from '../../common/rng'
import { createBoard, isFlooded, seedOwners } from './board'
import { fakeClock } from './fakeClock'
import { PuzzleSession } from './session'
import type { PuzzleState } from './session'
import type { Outcome } from './types'
import type { DealtBoard } from './generate'

/** A deal built by hand, so a test can control exactly how it plays out. */
function dealOf(
  rows: string[],
  numColors: number,
  maxMoves: number,
): DealtBoard {
  const cols = rows[0]!.length
  const board = createBoard(cols, rows.length, numColors)
  rows.forEach((row, r) => {
    for (let c = 0; c < cols; c++) board.color[r * cols + c] = Number(row[c])
  })
  seedOwners(board, 1)
  return { board, par: maxMoves, maxMoves }
}

/** A session already past its deal-in hold and accepting taps. */
async function openSession(
  deal: DealtBoard,
): Promise<{ session: PuzzleSession; clock: ReturnType<typeof fakeClock> }> {
  const clock = fakeClock()
  const session = new PuzzleSession({
    host: clock.host,
    preset: 'small',
    random: seededRandom(1),
    deal,
  })
  session.start()
  await clock.advance()
  return { session, clock }
}

describe('opening a board', () => {
  it('holds through the deal-in before accepting a tap', async () => {
    const clock = fakeClock()
    const session = new PuzzleSession({
      host: clock.host,
      preset: 'small',
      random: seededRandom(1),
      deal: dealOf(['01', '11'], 2, 5),
    })
    session.start()
    expect(session.state).toBe('dealing')
    expect(session.play(1)).toBe(false)
    expect(session.movesUsed).toBe(0)

    await clock.advance()
    expect(session.state).toBe('playing')
    expect(session.play(1)).toBe(true)
  })

  it('reports the starting region as progress', async () => {
    const { session } = await openSession(dealOf(['001', '111', '111'], 2, 5))
    expect(session.owned).toBe(2)
    expect(session.total).toBe(9)
  })
})

describe('playing a board', () => {
  it('counts a move and spends the allowance', async () => {
    const { session } = await openSession(
      dealOf(['0122', '1122', '2222'], 3, 4),
    )
    expect(session.maxMoves).toBe(4)
    session.play(1)
    expect(session.movesUsed).toBe(1)
    expect(session.maxMoves - session.movesUsed).toBe(3)
  })

  it('does not spend a move on the color already showing', async () => {
    const { session } = await openSession(dealOf(['01', '11'], 2, 5))
    expect(session.currentColor).toBe(0)
    expect(session.play(0)).toBe(false)
    expect(session.movesUsed).toBe(0)
  })

  it('wins the moment the board is one color', async () => {
    const { session } = await openSession(dealOf(['01', '11'], 2, 5))
    const seen: Outcome[] = []
    session.events.on('finished', (e) => seen.push(e.outcome))
    session.play(1)
    expect(session.state).toBe('won')
    expect(seen).toEqual(['flooded'])
    expect(isFlooded(session.board, 1)).toBe(true)
  })

  it('loses when the allowance runs out short of the whole board', async () => {
    // Alternating stripes need more than one move, so an allowance of one runs
    // out with cells still unclaimed.
    const { session } = await openSession(dealOf(['012', '120', '201'], 3, 1))
    const seen: Outcome[] = []
    session.events.on('finished', (e) => seen.push(e.outcome))
    session.play(1)
    expect(session.state).toBe('lost')
    expect(seen).toEqual(['outOfMoves'])
  })

  it('accepts nothing once the board is over', async () => {
    const { session } = await openSession(dealOf(['01', '11'], 2, 5))
    session.play(1)
    expect(session.finished).toBe(true)
    expect(session.play(0)).toBe(false)
  })

  it('announces every state it passes through, in order', async () => {
    const clock = fakeClock()
    const session = new PuzzleSession({
      host: clock.host,
      preset: 'small',
      random: seededRandom(1),
      deal: dealOf(['01', '11'], 2, 5),
    })
    const states: PuzzleState[] = []
    session.events.on('stateChanged', (s) => states.push(s))
    session.start()
    await clock.advance()
    session.play(1)
    expect(states).toEqual(['dealing', 'playing', 'won'])
  })

  it('hands the move result to listeners with the depths filled in', async () => {
    const { session } = await openSession(dealOf(['0111'], 2, 5))
    let maxDepth = -1
    let count = 0
    session.events.on('moved', (e) => {
      maxDepth = e.result.maxDepth
      count = e.result.count
    })
    session.play(1)
    expect(count).toBe(4)
    expect(maxDepth).toBe(3)
  })
})

describe('redealing', () => {
  it('opens a fresh board and resets the counter', async () => {
    const { session, clock } = await openSession(dealOf(['01', '11'], 2, 5))
    session.play(1)
    expect(session.movesUsed).toBe(1)

    session.redeal(dealOf(['012', '120', '201'], 3, 6))
    expect(session.state).toBe('dealing')
    expect(session.movesUsed).toBe(0)
    expect(session.maxMoves).toBe(6)

    await clock.advance()
    expect(session.state).toBe('playing')
  })

  it('deals from its own preset when handed nothing', async () => {
    const { session, clock } = await openSession(dealOf(['01', '11'], 2, 5))
    session.redeal()
    await clock.advance()
    expect(session.board.cols).toBe(10)
    expect(session.state).toBe('playing')
  })
})

describe('teardown', () => {
  it('cannot open a board after being destroyed', async () => {
    const clock = fakeClock()
    const session = new PuzzleSession({
      host: clock.host,
      preset: 'small',
      random: seededRandom(1),
      deal: dealOf(['01', '11'], 2, 5),
    })
    session.start()
    session.destroy()
    await clock.advance()
    expect(session.state).toBe('dealing')
    expect(session.play(1)).toBe(false)
  })
})
