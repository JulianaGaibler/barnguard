import { describe, expect, it } from 'vitest'
import { Node2D } from '@src/stargazer'
import { seededRandom } from '../../common/rng'
import {
  absorbGains,
  applyMove,
  createBoard,
  createMoveResult,
  fillRandom,
  isFlooded,
  ownedCount,
  seedOwners,
  unownedCount,
} from './board'
import { bestGain } from './generate'
import { buildAutoBoard, type AutoBoardOptions } from './autoBoard'
import { fakeClock } from './fakeClock'
import { ANIM } from './tuning'

/**
 * The self-playing board backs the menu preview and every tutorial card, so it
 * runs unattended for as long as the booth is up. What matters is that it makes
 * progress, loops rather than stalling, and stops dead when destroyed.
 *
 * Only the greedy driver is exercised here. The drawing it feeds needs a real
 * stage, and per this repo's convention that is checked in a `?demo=` scene
 * rather than in a test.
 */
function build(overrides: Partial<AutoBoardOptions> = {}): {
  auto: ReturnType<typeof buildAutoBoard>
  clock: ReturnType<typeof fakeClock>
} {
  const clock = fakeClock()
  const auto = buildAutoBoard({
    host: clock.host,
    parent: new Node2D('test-parent'),
    rect: { x: 0, y: 0, width: 600, height: 600 },
    grid: { cols: 8, rows: 8, colors: 4 },
    seed: 7,
    ...overrides,
  })
  return { auto, clock }
}

describe('buildAutoBoard', () => {
  it('takes ground on every move and never gives any back', async () => {
    const { auto, clock } = build({ seed: 3 })
    let owned = ownedCount(auto.board, 1)
    let steps = 0
    while (clock.pending > 0 && steps++ < 40) {
      await clock.advance()
      if (isFlooded(auto.board, 1)) break
      const now = ownedCount(auto.board, 1)
      expect(now).toBeGreaterThanOrEqual(owned)
      owned = now
    }
    expect(auto.moves).toBeGreaterThan(1)
    expect(owned).toBeGreaterThan(ownedCount(auto.board, 2))
    auto.destroy()
  })

  it('floods the board, then deals another one', async () => {
    const { auto, clock } = build({ seed: 9 })
    const first = auto.board

    let guard = 0
    while (!isFlooded(auto.board, 1) && clock.pending > 0 && guard++ < 60) {
      await clock.advance()
    }
    expect(isFlooded(first, 1)).toBe(true)

    // One more beat clears the celebration hold and deals again.
    await clock.advance()
    await clock.advance()
    expect(auto.board).not.toBe(first)
    expect(isFlooded(auto.board, 1)).toBe(false)
    auto.destroy()
  })

  it('stops the moment it is destroyed', async () => {
    const { auto, clock } = build({ seed: 11 })
    await clock.advance()
    expect(clock.pending).toBeGreaterThan(0)
    const movesAtDestroy = auto.moves

    auto.destroy()
    await clock.advance()
    // A destroyed board queues no further wait and takes no further move.
    expect(clock.pending).toBe(0)
    expect(auto.moves).toBe(movesAtDestroy)
  })
})

describe('an explicit grid', () => {
  // The tutorial cards use a board smaller than any preset, so the grid override
  // is what they rely on.
  it('deals exactly the grid it is given', async () => {
    const { auto } = build({ grid: { cols: 5, rows: 5, colors: 4 }, seed: 2 })
    expect(auto.board.cols).toBe(5)
    expect(auto.board.rows).toBe(5)
    expect(auto.board.numColors).toBe(4)
    for (const c of auto.board.color) expect(c).toBeLessThan(4)
    auto.destroy()
  })

  it('reports an allowance a counter can read against', async () => {
    const { auto } = build({ grid: { cols: 5, rows: 5, colors: 4 }, seed: 6 })
    expect(auto.limit).toBeGreaterThan(0)
    expect(auto.limit).toBeLessThan(auto.board.color.length)
    expect(auto.moves).toBe(0)
    auto.destroy()
  })

  it('resets the count when it deals again', async () => {
    const { auto, clock } = build({
      grid: { cols: 4, rows: 4, colors: 3 },
      seed: 4,
    })
    let guard = 0
    while (!isFlooded(auto.board, 1) && clock.pending > 0 && guard++ < 60) {
      await clock.advance()
    }
    expect(auto.moves).toBeGreaterThan(0)

    // Past the celebration hold, a fresh deal starts the count over, so a
    // counter on a tutorial card reads this deal and not the whole session.
    await clock.advance()
    await clock.advance()
    expect(auto.moves).toBe(0)
    auto.destroy()
  })
})

describe('coming to rest', () => {
  const GRID = { cols: 8, rows: 8, colors: 5 }

  it('takes the moves it was given and then stops', async () => {
    const { auto, clock } = build({ grid: GRID, seed: 3, stopAfter: 3 })
    let guard = 0
    while (clock.pending > 0 && guard++ < 40) await clock.advance()
    expect(auto.moves).toBe(3)
    // Nothing outstanding means it will never move again on its own, which is
    // the point for a backdrop.
    expect(clock.pending).toBe(0)
    auto.destroy()
  })

  it('holds the board it stopped on rather than dealing another', async () => {
    const { auto, clock } = build({ grid: GRID, seed: 5, stopAfter: 2 })
    const settled = auto.board
    let guard = 0
    while (clock.pending > 0 && guard++ < 40) await clock.advance()
    expect(auto.board).toBe(settled)
    // A few more turns of the clock change nothing.
    await clock.advance()
    await clock.advance()
    expect(auto.moves).toBe(2)
    expect(auto.board).toBe(settled)
    auto.destroy()
  })

  it('keeps looping when no stop is asked for', async () => {
    const { auto, clock } = build({
      grid: { cols: 4, rows: 4, colors: 3 },
      seed: 4,
    })
    let guard = 0
    while (clock.pending > 0 && guard++ < 80) await clock.advance()
    // The looping board never runs out of work, so the guard is what ends this.
    expect(guard).toBeGreaterThan(20)
    auto.destroy()
  })
})

describe('pacing', () => {
  const GRID = { cols: 10, rows: 10, colors: 5 }

  /** Waits the board asked for, minus the opening one that lets it deal in. */
  async function runToRest(stopAfter: number, beat: number): Promise<number[]> {
    const clock = fakeClock()
    const auto = buildAutoBoard({
      host: clock.host,
      parent: new Node2D('test-parent'),
      rect: { x: 0, y: 0, width: 600, height: 600 },
      grid: GRID,
      seed: 21,
      stopAfter,
      beat,
    })
    let guard = 0
    while (clock.pending > 0 && guard++ < 60) await clock.advance()
    auto.destroy()
    return clock.waits.slice(1)
  }

  it('holds an even beat across the whole run', async () => {
    // The menu backdrop steps at one pace and then stops. Gaps vary only by the
    // flood inside them, which deepens as the region grows, so the spread has to
    // stay well under the beat itself.
    const beat = 0.18
    const gaps = await runToRest(9, beat)
    expect(gaps).toHaveLength(9)
    for (const gap of gaps) expect(gap).toBeGreaterThanOrEqual(beat)
    const spread = Math.max(...gaps) - Math.min(...gaps)
    expect(spread).toBeLessThanOrEqual(ANIM.floodDurationCap)
  })

  it('never pauses for less than the flood it follows', async () => {
    // A shorter gap would start the next move over a board still moving.
    const gaps = await runToRest(9, 0.18)
    for (const gap of gaps) expect(gap).toBeGreaterThan(ANIM.floodFlip)
  })

  it('takes longer overall with a longer beat', async () => {
    const total = (gaps: number[]): number => gaps.reduce((a, b) => a + b, 0)
    const quick = total(await runToRest(9, 0.1))
    const slow = total(await runToRest(9, 0.5))
    expect(slow).toBeGreaterThan(quick)
    expect(slow - quick).toBeCloseTo(9 * 0.4, 6)
  })
})

describe('a carved board', () => {
  // The menu backdrop's own shape, so this covers what actually ships.
  const GRID = { cols: 16, rows: 16, colors: 7 }
  const CARVE = 0.62

  /** How many cells each row loses to the cut. */
  function cutDepths(board: { cols: number; rows: number; color: Uint8Array }) {
    const out: number[] = []
    for (let row = 0; row < board.rows; row++) {
      let depth = 0
      while (
        depth < board.cols &&
        board.color[row * board.cols + depth] === 0
      ) {
        depth++
      }
      out.push(depth)
    }
    return out
  }

  it('cuts nothing from the top and plenty from the bottom', async () => {
    const { auto } = build({ grid: GRID, seed: 7, carveLeftFrac: CARVE })
    const depths = cutDepths(auto.board)
    expect(depths[0]).toBe(0)
    expect(depths[15]!).toBeGreaterThan(3)
    auto.destroy()
  })

  it('starts the region on solid ground every time', async () => {
    for (let seed = 0; seed < 12; seed++) {
      const { auto } = build({ grid: GRID, seed, carveLeftFrac: CARVE })
      expect(auto.board.color[0], `seed ${seed}`).not.toBe(0)
      expect(ownedCount(auto.board, 1), `seed ${seed}`).toBeGreaterThan(0)
      auto.destroy()
    }
  })

  it('runs its whole course without being walled in', async () => {
    // The point of sparing the top rows. A region boxed in by the cut would stop
    // the backdrop after a move or two.
    const { auto, clock } = build({
      grid: GRID,
      seed: 7,
      carveLeftFrac: CARVE,
      stopAfter: 9,
      beat: 0.18,
    })
    let guard = 0
    while (clock.pending > 0 && guard++ < 60) await clock.advance()
    expect(auto.moves).toBe(9)
    auto.destroy()
  })

  it('holds every cut cell through the whole run', async () => {
    const { auto, clock } = build({
      grid: GRID,
      seed: 7,
      carveLeftFrac: CARVE,
      stopAfter: 9,
      beat: 0.18,
    })
    const carved = [...auto.board.color]
      .map((c, i) => (c === 0 ? i : -1))
      .filter((i) => i >= 0)
    expect(carved.length).toBeGreaterThan(15)

    let guard = 0
    while (clock.pending > 0 && guard++ < 60) await clock.advance()

    // The cut only survives because the run never floods to its color. One
    // filled cell would start the straight edge reappearing.
    for (const i of carved) expect(auto.board.color[i], `cut ${i}`).toBe(0)
    auto.destroy()
  })

  it('confines the carve colour to the cut', async () => {
    // On a carved board colour 0 means "cut away", so it must not appear in the
    // body. A stray one would be a hole nothing can ever fill.
    const { auto } = build({ grid: GRID, seed: 7, carveLeftFrac: CARVE })
    const { color, cols, rows } = auto.board
    const depths = cutDepths(auto.board)
    for (let row = 0; row < rows; row++) {
      for (let col = depths[row]!; col < cols; col++) {
        expect(color[row * cols + col], `${row},${col}`).toBeGreaterThan(0)
      }
    }
    auto.destroy()
  })

  it('deals the carve colour anywhere when no carve was asked for', async () => {
    // Without a carve there is nothing reserved, so colour 0 is just another
    // colour and turns up across the whole board.
    const { auto } = build({ grid: GRID, seed: 7 })
    const { color, cols, rows } = auto.board
    let onTheRight = 0
    for (let row = 0; row < rows; row++) {
      for (let col = Math.floor(cols / 2); col < cols; col++) {
        if (color[row * cols + col] === 0) onTheRight++
      }
    }
    expect(onTheRight).toBeGreaterThan(0)
    auto.destroy()
  })
})

describe('the greedy driver', () => {
  it('always has a gainful move on an unflooded board', async () => {
    // The loop relies on this: without it, an unattended preview could spin
    // forever taking nothing.
    for (let seed = 0; seed < 20; seed++) {
      const board = createBoard(10, 10, 4)
      fillRandom(board, seededRandom(seed))
      seedOwners(board, 1)
      const scratch = createBoard(10, 10, 4)
      const res = createMoveResult(board)
      const gains = new Int32Array(4)

      while (!isFlooded(board, 1)) {
        absorbGains(board, 1, scratch, res, gains)
        const pick = bestGain(gains)
        expect(pick, `seed ${seed} stalled`).toBeGreaterThanOrEqual(0)
        const before = ownedCount(board, 1)
        applyMove(board, 1, pick, res)
        expect(ownedCount(board, 1)).toBeGreaterThan(before)
      }
      expect(unownedCount(board)).toBe(0)
    }
  })
})
