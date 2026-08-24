import { describe, expect, it } from 'vitest'
import {
  clearRows,
  COLS,
  createBuffer,
  lockPiece,
  VISIBLE_TOP,
  type Buffer,
} from './board'
import {
  canSpawn,
  classifyTwist,
  commit,
  createLockTimer,
  dropDistance,
  hardDropTarget,
  isGrounded,
  LOCK_RESET_LIMIT,
  lockedOutOfView,
  noteMove,
  resetLockTimer,
  spawnPiece,
  tickLockTimer,
  tryRotate,
  tryShift,
  type ActivePiece,
} from './rules'
import type { PieceKind } from './types'

const fillRow = (b: Buffer, y: number, gaps: number[] = []): void => {
  for (let x = 0; x < b.cols; x++) {
    if (!gaps.includes(x)) b.cells[y * b.cols + x] = 'I'
  }
}

const at = (kind: PieceKind, x: number, y: number, rot = 0): ActivePiece =>
  ({ kind, rot, x, y }) as ActivePiece

describe('shifting', () => {
  it('moves into open space', () => {
    const b = createBuffer()
    expect(tryShift(b, at('T', 3, 5), 1, 0)?.x).toBe(4)
  })

  it('refuses to move through a wall', () => {
    const b = createBuffer()
    // The T's box starts at column 0, so it is already against the left wall.
    expect(tryShift(b, at('T', 0, 5), -1, 0)).toBeNull()
  })

  it('refuses to move into a locked cell', () => {
    const b = createBuffer()
    b.cells[5 * COLS + 6] = 'Z'
    expect(tryShift(b, at('O', 4, 5), 1, 0)).toBeNull()
  })

  it('leaves the original piece untouched', () => {
    const b = createBuffer()
    const p = at('T', 3, 5)
    tryShift(b, p, 1, 1)
    expect(p).toEqual({ kind: 'T', rot: 0, x: 3, y: 5 })
  })
})

describe('grounding and dropping', () => {
  it('is not grounded over open space', () => {
    expect(isGrounded(createBuffer(), at('O', 4, 5))).toBe(false)
  })

  it('is grounded on the floor', () => {
    const b = createBuffer()
    const landed = hardDropTarget(b, at('O', 4, 0))
    expect(isGrounded(b, landed)).toBe(true)
  })

  it('drops to rest on the stack, not through it', () => {
    const b = createBuffer()
    fillRow(b, 20)
    fillRow(b, 21)
    const landed = hardDropTarget(b, at('O', 4, 0))
    // The square's box is two tall, so its top row sits at 18.
    expect(landed.y).toBe(18)
  })

  it('reports the distance a hard drop would fall', () => {
    const b = createBuffer()
    const p = at('O', 4, 0)
    expect(dropDistance(b, p)).toBe(hardDropTarget(b, p).y - p.y)
    expect(dropDistance(b, p)).toBeGreaterThan(0)
  })
})

describe('rotation', () => {
  it('turns in place when nothing is in the way', () => {
    const b = createBuffer()
    const r = tryRotate(b, at('T', 3, 5), 1)
    expect(r?.kickIndex).toBe(0)
    expect(r?.piece.rot).toBe(1)
    expect(r?.piece.x).toBe(3)
  })

  it('kicks off the left wall rather than failing', () => {
    const b = createBuffer()
    // Upright I hard against the left wall: turning flat needs a shove right.
    const upright = at('I', -1, 5, 1)
    const r = tryRotate(b, upright, 1)
    expect(r).not.toBeNull()
    expect(r!.kickIndex).toBeGreaterThan(0)
  })

  it('returns null when no kick fits', () => {
    const b = createBuffer()
    // Bury a T in a one-cell-tall slot: every candidate overlaps something.
    for (let y = 0; y < b.rows; y++) {
      for (let x = 0; x < b.cols; x++) {
        if (y !== 5 || x < 3 || x > 5) b.cells[y * b.cols + x] = 'Z'
      }
    }
    expect(tryRotate(b, at('T', 3, 4, 1), 1)).toBeNull()
  })

  it('turns anticlockwise back to where it started', () => {
    const b = createBuffer()
    const p = at('L', 3, 5)
    const cw = tryRotate(b, p, 1)!
    const back = tryRotate(b, cw.piece, -1)!
    expect(back.piece).toEqual(p)
  })

  it('never displaces the square', () => {
    const b = createBuffer()
    const p = at('O', 4, 5)
    for (const dir of [1, -1] as const) {
      const r = tryRotate(b, p, dir)!
      expect(r.piece.x).toBe(p.x)
      expect(r.piece.y).toBe(p.y)
    }
  })
})

describe('overflow', () => {
  it('lets a piece in over an empty buffer', () => {
    expect(canSpawn(createBuffer(), 'I')).toBe(true)
  })

  it('refuses a piece when the spawn band is blocked', () => {
    const b = createBuffer()
    fillRow(b, 0)
    fillRow(b, 1)
    expect(canSpawn(b, 'T')).toBe(false)
  })

  it('recognises a piece that locked entirely above the view', () => {
    expect(lockedOutOfView(at('O', 4, 0))).toBe(true)
    expect(lockedOutOfView(at('O', 4, VISIBLE_TOP))).toBe(false)
  })

  it('spawns every shape inside the band', () => {
    for (const kind of ['I', 'O', 'T', 'S', 'Z', 'J', 'L'] as PieceKind[]) {
      expect(spawnPiece(kind).y).toBe(0)
    }
  })
})

describe('twists', () => {
  /**
   * A T-slot: a one-cell notch with filled shoulders, the shape a T can only be
   * turned into and never dropped into.
   */
  const tSlotBuffer = (): Buffer => {
    const b = createBuffer()
    // The floor, with a one-cell notch the T's nub drops into.
    fillRow(b, 21, [4])
    // Shoulders two rows up, which is what puts all four box corners in solid
    // cells while leaving the bar's row open.
    b.cells[19 * COLS + 3] = 'I'
    b.cells[19 * COLS + 5] = 'I'
    return b
  }

  it('is never a twist unless a rotation caused the lock', () => {
    const b = tSlotBuffer()
    expect(classifyTwist(b, at('T', 3, 19, 2), false, 0)).toBe('none')
  })

  it('is never a twist for a shape other than the T', () => {
    const b = tSlotBuffer()
    expect(classifyTwist(b, at('L', 3, 19, 2), true, 0)).toBe('none')
  })

  it('is not a twist with fewer than three corners filled', () => {
    const b = createBuffer()
    b.cells[21 * COLS + 3] = 'I'
    expect(classifyTwist(b, at('T', 3, 19, 2), true, 0)).toBe('none')
  })

  it('scores a full twist when both front corners are filled', () => {
    const b = tSlotBuffer()
    // Rotation 2 points the nub down into the notch, so the front corners are
    // the two below, both filled by row 21's shoulders.
    expect(classifyTwist(b, at('T', 3, 19, 2), true, 0)).toBe('full')
  })

  it('scores a mini when only one front corner is filled', () => {
    const b = createBuffer()
    // Three corners filled, but only one of the pair the T faces.
    b.cells[19 * COLS + 3] = 'I'
    b.cells[19 * COLS + 5] = 'I'
    b.cells[21 * COLS + 3] = 'I'
    expect(classifyTwist(b, at('T', 3, 19, 2), true, 0)).toBe('mini')
  })

  it('promotes a mini to full when it took the deepest kick', () => {
    // The last table entry is the two-row lift, which nothing can fall into.
    const b = createBuffer()
    b.cells[19 * COLS + 3] = 'I'
    b.cells[19 * COLS + 5] = 'I'
    b.cells[21 * COLS + 3] = 'I'
    expect(classifyTwist(b, at('T', 3, 19, 2), true, 4)).toBe('full')
  })
})

describe('lock timer', () => {
  it('does not run while the piece is in the air', () => {
    const t = createLockTimer()
    expect(tickLockTimer(t, 10, 0.5)).toBe(false)
  })

  it('locks once the delay elapses on the ground', () => {
    const t = createLockTimer()
    noteMove(t, true)
    expect(tickLockTimer(t, 0.4, 0.5)).toBe(false)
    expect(tickLockTimer(t, 0.2, 0.5)).toBe(true)
  })

  it('restarts the countdown on a move', () => {
    const t = createLockTimer()
    noteMove(t, true)
    tickLockTimer(t, 0.4, 0.5)
    noteMove(t, true)
    expect(tickLockTimer(t, 0.4, 0.5)).toBe(false)
  })

  it('stops resetting after the limit, so a piece cannot be stalled forever', () => {
    // Without this a player mashes rotate and rests indefinitely, which breaks
    // Uptime and lets Countdown be played with the clock effectively paused.
    const t = createLockTimer()
    noteMove(t, true)
    for (let i = 0; i < LOCK_RESET_LIMIT; i++) {
      tickLockTimer(t, 0.4, 0.5)
      noteMove(t, true)
    }
    expect(t.resets).toBe(LOCK_RESET_LIMIT)
    // The budget is spent, so the next nudge no longer buys time.
    tickLockTimer(t, 0.4, 0.5)
    noteMove(t, true)
    expect(tickLockTimer(t, 0.2, 0.5)).toBe(true)
  })

  it('keeps the reset budget when the piece leaves the ground', () => {
    // Otherwise sliding off a ledge and back on refills it, which is the same
    // exploit by another route.
    const t = createLockTimer()
    noteMove(t, true)
    noteMove(t, true)
    expect(t.resets).toBe(1)
    noteMove(t, false)
    noteMove(t, true)
    expect(t.resets).toBe(1)
  })

  it('starts clean for the next piece', () => {
    const t = createLockTimer()
    noteMove(t, true)
    noteMove(t, true)
    resetLockTimer(t)
    expect(t).toEqual({ elapsed: 0, resets: 0, grounded: false })
  })
})

describe('committing', () => {
  it('writes the piece and can then clear its row', () => {
    const b = createBuffer()
    fillRow(b, 21, [3, 4, 5, 6])
    // The flat I sits on the second row of its own box, so y is one above the
    // row it fills.
    commit(b, at('I', 3, 20))
    expect(b.cells.slice(21 * COLS, 22 * COLS).every((c) => c !== null)).toBe(
      true,
    )
    clearRows(b, [21])
    expect(b.cells.every((c) => c === null)).toBe(true)
  })

  it('agrees with lockPiece', () => {
    const a = createBuffer()
    const c = createBuffer()
    commit(a, at('S', 2, 7, 1))
    lockPiece(c, 'S', 1, 2, 7)
    expect(a.cells).toEqual(c.cells)
  })
})
