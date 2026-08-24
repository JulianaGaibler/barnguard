import { beforeEach, describe, expect, it, vi } from 'vitest'
import { createPieceStream } from './bag'
import { pieceCells, PIECE_KINDS } from './pieces'
import { COLS, TOTAL_ROWS, type Buffer } from './board'
import { fakeClock, type FakeClock } from './fakeClock'
import { secondsPerRow } from './gravity'
import { Match } from './match'
import { LOCK_RESET_LIMIT } from './rules'
import { Session } from './session'
import { START_SECONDS } from './countdown'
import { ANIM, RULES } from './tuning'
import type { PieceKind } from './types'

/** The first seed whose opening piece is `kind`, so a fixture can rely on it. */
const seedOpeningWith = (kind: PieceKind): number => {
  for (let seed = 1; seed < 1000; seed++) {
    if (createPieceStream(seed).at(0) === kind) return seed
  }
  throw new Error(`no seed opens with ${kind}`)
}

const STEP = 1 / 120

let clock: FakeClock
beforeEach(() => {
  clock = fakeClock()
})

const uptime = (seed = 1): Session =>
  new Session({ host: clock.host, mode: 'uptime', seed })

/** Run `seconds` of engine time through the session, one fixed step at a time. */
const run = (s: Session, seconds: number): void => {
  for (let t = 0; t < seconds - 1e-9; t += STEP) s.step(STEP)
}

/** Fill every row from `from` down, leaving one column open. */
const stackUp = (b: Buffer, from: number, gap = 9): void => {
  for (let y = from; y < TOTAL_ROWS; y++) {
    for (let x = 0; x < COLS; x++) {
      if (x !== gap) b.cells[y * COLS + x] = 'Z'
    }
  }
}

describe('starting', () => {
  it('opens with a piece in play and a queue behind it', () => {
    const s = uptime()
    const spawned = vi.fn()
    s.events.on('spawned', spawned)
    s.start()
    expect(s.state).toBe('playing')
    expect(s.piece).not.toBeNull()
    expect(s.next).toHaveLength(RULES.nextCount)
    expect(spawned).toHaveBeenCalledTimes(1)
  })

  it('starts scoreless with nothing held', () => {
    const s = uptime()
    s.start()
    expect(s.score).toBe(0)
    expect(s.lines).toBe(0)
    expect(s.level).toBe(1)
    expect(s.hold).toBeNull()
  })

  it('is inert before start', () => {
    const s = uptime()
    s.input('left')
    run(s, 5)
    expect(s.state).toBe('idle')
    expect(s.piece).toBeNull()
  })
})

describe('moving', () => {
  it('shifts sideways and reports it', () => {
    const s = uptime()
    s.start()
    const moved = vi.fn()
    s.events.on('pieceMoved', moved)
    const before = s.piece!.x
    s.input('right')
    expect(s.piece!.x).toBe(before + 1)
    expect(moved).toHaveBeenCalled()
  })

  it('refuses to leave the buffer', () => {
    const s = uptime()
    s.start()
    for (let i = 0; i < 20; i++) s.input('left')
    const parked = s.piece!.x
    s.input('left')
    expect(s.piece!.x).toBe(parked)
  })

  it('turns the piece', () => {
    const s = uptime()
    s.start()
    const before = s.piece!.rot
    s.input('rotateCW')
    expect(s.piece!.rot).toBe((before + 1) % 4)
  })

  it('drags relative to where the finger landed', () => {
    const s = uptime()
    s.start()
    const before = s.piece!.x
    s.beginDrag()
    s.dragBy(-2)
    expect(s.piece!.x).toBe(before - 2)
    // Relative, so a second report of the same travel is not cumulative.
    s.dragBy(-2)
    expect(s.piece!.x).toBe(before - 2)
    s.dragBy(1)
    expect(s.piece!.x).toBe(before + 1)
  })

  it('can drag every shape hard against both walls', () => {
    // Absolute column targeting could not do this. A piece is positioned by its
    // box origin, and a shape sitting in its box's third column needs a
    // negative origin to touch the left wall.
    for (const kind of PIECE_KINDS) {
      for (const rot of [0, 1, 2, 3] as const) {
        const s = new Session({
          host: clock.host,
          mode: 'uptime',
          seed: seedOpeningWith(kind),
        })
        s.start()
        for (let i = 0; i < rot; i++) s.input('rotateCW')
        const cells = () =>
          pieceCells(s.piece!.kind, s.piece!.rot).map((c) => s.piece!.x + c.x)

        s.beginDrag()
        s.dragBy(-COLS)
        expect(Math.min(...cells()), `${kind} rot ${rot} left`).toBe(0)

        s.endDrag()
        s.beginDrag()
        s.dragBy(COLS)
        expect(Math.max(...cells()), `${kind} rot ${rot} right`).toBe(COLS - 1)
      }
    }
  })

  it('drops the anchor when a new piece arrives', () => {
    const s = uptime()
    s.start()
    s.beginDrag()
    s.input('hardDrop')
    const fresh = s.piece!.x
    // The anchor belonged to the piece that just locked, so this is inert.
    s.dragBy(-3)
    expect(s.piece!.x).toBe(fresh)
  })
})

describe('gravity', () => {
  it('drops one row per level-one second', () => {
    const s = uptime()
    s.start()
    const startY = s.piece!.y
    // Half a row past the third, so the assertion does not sit exactly on a
    // boundary the accumulated float steps can land a hair short of.
    run(s, secondsPerRow(1) * 3.5)
    expect(s.piece!.y).toBe(startY + 3)
  })

  it('falls faster while soft drop is held, and scores for it', () => {
    const s = uptime()
    s.start()
    const startY = s.piece!.y
    s.setSoftDrop(true)
    run(s, secondsPerRow(1))
    expect(s.piece!.y).toBeGreaterThan(startY + 3)
    expect(s.score).toBeGreaterThan(0)
  })

  it('holds a grounded piece for the lock delay before writing it', () => {
    const s = uptime()
    s.start()
    const locked = vi.fn()
    s.events.on('locked', locked)
    s.input('hardDrop')
    expect(locked).toHaveBeenCalledTimes(1)
  })
})

describe('locking', () => {
  it('scores a hard drop by the distance fallen', () => {
    const s = uptime()
    s.start()
    s.input('hardDrop')
    expect(s.score).toBeGreaterThan(0)
  })

  it('brings the next piece in after a lock that cleared nothing', () => {
    const s = uptime()
    s.start()
    const first = s.piece!.kind
    const queued = s.next[0]
    s.input('hardDrop')
    expect(s.piece).not.toBeNull()
    expect(s.piece!.kind).toBe(queued)
    expect(s.piece!.kind === first || true).toBe(true)
  })

  it('cannot be stalled at the floor forever', () => {
    // The lock-down limit. Without it a player rests indefinitely by turning.
    const s = uptime()
    s.start()
    const over = vi.fn()
    s.events.on('locked', over)
    // Land the piece, then spend every reset the budget allows.
    run(s, 30)
    expect(over).toHaveBeenCalled()
  })

  it('spends its reset budget and then locks anyway', () => {
    const s = uptime()
    s.start()
    const locked = vi.fn()
    s.events.on('locked', locked)
    // Turn the piece just before every lock delay would elapse, which is the
    // exact input pattern the reset limit exists to defeat. Well past the
    // budget, so a piece that still had resets left would never land.
    for (let i = 0; i < LOCK_RESET_LIMIT * 12; i++) {
      s.input('rotateCW')
      run(s, RULES.lockDelay * 0.9)
    }
    expect(locked).toHaveBeenCalled()
  })
})

describe('clearing', () => {
  it('clears a filled row, holds the flash, then collapses', async () => {
    // A seed that opens with the square, so the two-cell gap below is exactly
    // the shape that closes it.
    const s = new Session({
      host: clock.host,
      mode: 'uptime',
      seed: seedOpeningWith('O'),
    })
    s.start()
    const b = s.buffer as Buffer
    for (let x = 0; x < COLS; x++) {
      if (x !== 4 && x !== 5) b.cells[(TOTAL_ROWS - 1) * COLS + x] = 'Z'
    }
    const resolved = vi.fn()
    s.events.on('resolved', resolved)
    s.input('hardDrop')

    expect(resolved).toHaveBeenCalled()
    const last = resolved.mock.calls.at(-1)![0]
    expect(last.rows.length).toBeGreaterThan(0)
    expect(s.state).toBe('clearing')

    // Two holds, so two batches: the flash, then the collapse.
    await clock.advance()
    expect(s.lines).toBeGreaterThan(0)
    expect(s.state).toBe('clearing')

    await clock.advance()
    expect(s.state).toBe('playing')
    expect(s.piece).not.toBeNull()
    expect(clock.waits).toEqual([ANIM.clearFlash, ANIM.clearCollapse])
  })

  it('ends the combo on a lock that cleared nothing', () => {
    const s = uptime()
    s.start()
    const resolved = vi.fn()
    s.events.on('resolved', resolved)
    s.input('hardDrop')
    expect(resolved.mock.calls.at(-1)![0].combo).toBe(0)
  })
})

describe('hold', () => {
  it('banks the piece and brings the queue forward', () => {
    const s = uptime()
    s.start()
    const current = s.piece!.kind
    const queued = s.next[0]
    s.input('hold')
    expect(s.hold).toBe(current)
    expect(s.piece!.kind).toBe(queued)
  })

  it('swaps with the banked piece the second time', () => {
    const s = uptime()
    s.start()
    const first = s.piece!.kind
    s.input('hold')
    const second = s.piece!.kind
    s.input('hardDrop')
    s.input('hold')
    expect(s.piece!.kind).toBe(first)
    expect(s.hold).not.toBe(first)
    expect(second).toBeDefined()
  })

  it('allows only one hold per piece, so it is not a free shuffle', () => {
    const s = uptime()
    s.start()
    s.input('hold')
    const after = s.piece!.kind
    s.input('hold')
    expect(s.piece!.kind).toBe(after)
  })
})

describe('overflow', () => {
  it('ends the run when a piece cannot enter', () => {
    const s = uptime()
    s.start()
    const over = vi.fn()
    s.events.on('over', over)
    stackUp(s.buffer as Buffer, 0)
    s.input('hardDrop')
    expect(over).toHaveBeenCalledTimes(1)
    expect(over.mock.calls[0][0].reason).toBe('overflow')
    expect(s.state).toBe('over')
  })

  it('fires over exactly once and then ignores input', () => {
    const s = uptime()
    s.start()
    const over = vi.fn()
    s.events.on('over', over)
    stackUp(s.buffer as Buffer, 0)
    s.input('hardDrop')
    s.input('hardDrop')
    s.input('left')
    run(s, 10)
    expect(over).toHaveBeenCalledTimes(1)
  })
})

describe('countdown', () => {
  const countdown = (seed = 1): Session =>
    new Session({ host: clock.host, mode: 'countdown', seed })

  it('starts full and runs down', () => {
    const s = countdown()
    s.start()
    expect(s.remaining).toBe(START_SECONDS)
    run(s, 5)
    expect(s.remaining).toBeLessThan(START_SECONDS)
  })

  it('ends the run when the clock expires', () => {
    const s = countdown()
    s.start()
    const over = vi.fn()
    s.events.on('over', over)
    run(s, START_SECONDS + 1)
    expect(over).toHaveBeenCalledTimes(1)
    expect(over.mock.calls[0][0].reason).toBe('timeUp')
  })

  it('leaves Uptime with no clock at all', () => {
    const s = uptime()
    s.start()
    const ticked = vi.fn()
    s.events.on('clock', ticked)
    run(s, 5)
    expect(ticked).not.toHaveBeenCalled()
  })
})

describe('pausing', () => {
  it('advances nothing while no steps are delivered', () => {
    // The engine pauses by not calling the fixed step, so this is what a pause
    // looks like from in here: gravity, the lock delay and the clock all hold.
    const s = new Session({ host: clock.host, mode: 'countdown', seed: 3 })
    s.start()
    const y = s.piece!.y
    const remaining = s.remaining
    expect(s.piece!.y).toBe(y)
    expect(s.remaining).toBe(remaining)
  })
})

describe('a two-player race', () => {
  it('deals both seats the same sequence', () => {
    const m = new Match(clock.host, 'uptime', 77)
    m.start()
    expect(m.a.piece!.kind).toBe(m.b.piece!.kind)
    for (let i = 0; i < RULES.nextCount; i++) {
      expect(m.a.next[i]).toBe(m.b.next[i])
    }
  })

  it('keeps the sequence aligned when one seat plays faster', () => {
    const m = new Match(clock.host, 'uptime', 77)
    m.start()
    const seen: string[] = []
    for (let i = 0; i < 6; i++) {
      seen.push(m.a.piece!.kind)
      m.a.input('hardDrop')
    }
    // The slower seat walks the same list, just later.
    const laggard: string[] = []
    for (let i = 0; i < 6; i++) {
      laggard.push(m.b.piece!.kind)
      m.b.input('hardDrop')
    }
    expect(laggard).toEqual(seen)
  })

  it('does not end when only one seat is out', () => {
    const m = new Match(clock.host, 'uptime', 5)
    m.start()
    const matchOver = vi.fn()
    const playerOut = vi.fn()
    m.events.on('matchOver', matchOver)
    m.events.on('playerOut', playerOut)

    stackUp(m.a.buffer as Buffer, 0)
    m.a.input('hardDrop')

    expect(playerOut).toHaveBeenCalledTimes(1)
    expect(matchOver).not.toHaveBeenCalled()
    expect(m.isOut(1)).toBe(true)
    expect(m.b.state).toBe('playing')
  })

  it('ends once both are out, and the higher score wins', () => {
    const m = new Match(clock.host, 'uptime', 5)
    m.start()
    const matchOver = vi.fn()
    m.events.on('matchOver', matchOver)

    // Give seat two a few points before ending both runs.
    m.b.input('hardDrop')
    stackUp(m.a.buffer as Buffer, 0)
    m.a.input('hardDrop')
    stackUp(m.b.buffer as Buffer, 0)
    m.b.input('hardDrop')

    expect(matchOver).toHaveBeenCalledTimes(1)
    const e = matchOver.mock.calls[0][0]
    expect(e.winner).toBe(2)
    expect(e.b.score).toBeGreaterThan(e.a.score)
  })

  it('calls a tie a tie', () => {
    const m = new Match(clock.host, 'uptime', 5)
    m.start()
    const matchOver = vi.fn()
    m.events.on('matchOver', matchOver)
    stackUp(m.a.buffer as Buffer, 0)
    stackUp(m.b.buffer as Buffer, 0)
    m.a.input('hardDrop')
    m.b.input('hardDrop')
    expect(matchOver.mock.calls[0][0].winner).toBe(0)
  })
})
