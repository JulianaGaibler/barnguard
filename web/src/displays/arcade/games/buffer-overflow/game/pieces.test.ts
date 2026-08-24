import { describe, expect, it } from 'vitest'
import {
  kicksFor,
  pieceBox,
  pieceCells,
  PIECE_KINDS,
  spawnColumn,
} from './pieces'
import type { PieceKind, Rotation } from './types'

const ROTATIONS: Rotation[] = [0, 1, 2, 3]

/** A shape's cells at one rotation, as a sorted comparable string. */
const key = (kind: PieceKind, rot: Rotation): string =>
  pieceCells(kind, rot)
    .map((c) => `${c.x},${c.y}`)
    .sort()
    .join(' ')

describe('piece geometry', () => {
  it('gives every shape four cells in every orientation', () => {
    for (const kind of PIECE_KINDS) {
      for (const rot of ROTATIONS) {
        expect(pieceCells(kind, rot)).toHaveLength(4)
      }
    }
  })

  it('keeps every cell inside its own box', () => {
    for (const kind of PIECE_KINDS) {
      const size = pieceBox(kind)
      for (const rot of ROTATIONS) {
        for (const c of pieceCells(kind, rot)) {
          expect(c.x).toBeGreaterThanOrEqual(0)
          expect(c.y).toBeGreaterThanOrEqual(0)
          expect(c.x).toBeLessThan(size)
          expect(c.y).toBeLessThan(size)
        }
      }
    }
  })

  it('returns to the spawn shape after four turns', () => {
    for (const kind of PIECE_KINDS) {
      expect(key(kind, 0)).toBe(
        pieceCells(kind, 0)
          .map((c) => `${c.x},${c.y}`)
          .sort()
          .join(' '),
      )
      // Rotation 3 turned once more must land back on rotation 0, which the
      // generator guarantees only if the box is square and the map is a true
      // quarter turn.
      const size = pieceBox(kind)
      const onceMore = pieceCells(kind, 3)
        .map((c) => `${size - 1 - c.y},${c.x}`)
        .sort()
        .join(' ')
      expect(onceMore).toBe(key(kind, 0))
    }
  })

  it('turns the square onto itself', () => {
    // A 2x2 box is what makes this true without a special case, and it is why
    // the square never drifts sideways when a player spins it.
    for (const rot of ROTATIONS) expect(key('O', rot)).toBe(key('O', 0))
  })

  it('lays the flat piece along a row, then a column', () => {
    const flat = pieceCells('I', 0)
    expect(new Set(flat.map((c) => c.y)).size).toBe(1)
    const upright = pieceCells('I', 1)
    expect(new Set(upright.map((c) => c.x)).size).toBe(1)
  })

  it('turns the T to point right, down, then left', () => {
    // Spawn points up: the lone cell is above the bar.
    expect(key('T', 0)).toBe('0,1 1,0 1,1 2,1')
    expect(key('T', 1)).toBe('1,0 1,1 1,2 2,1')
    expect(key('T', 2)).toBe('0,1 1,1 1,2 2,1')
    expect(key('T', 3)).toBe('0,1 1,0 1,1 1,2')
  })

  it('centres every shape on spawn', () => {
    for (const kind of PIECE_KINDS) {
      const xs = pieceCells(kind, 0).map((c) => c.x + spawnColumn(kind))
      expect(Math.min(...xs)).toBeGreaterThanOrEqual(3)
      expect(Math.max(...xs)).toBeLessThanOrEqual(6)
    }
  })
})

describe('wall kicks', () => {
  it('tries the identity translation first, always', () => {
    for (const kind of PIECE_KINDS) {
      for (const from of ROTATIONS) {
        for (const dir of [1, -1] as const) {
          const to = ((((from + dir) % 4) + 4) % 4) as Rotation
          const first = kicksFor(kind, from, to)[0]
          expect(first).toEqual({ x: 0, y: 0 })
        }
      }
    }
  })

  it('offers five candidates for every shape but the square', () => {
    for (const kind of PIECE_KINDS) {
      if (kind === 'O') continue
      for (const from of ROTATIONS) {
        const to = ((from + 1) % 4) as Rotation satisfies Rotation
        expect(kicksFor(kind, from, to)).toHaveLength(5)
      }
    }
  })

  it('gives the square nowhere to kick to', () => {
    expect(kicksFor('O', 0, 1)).toEqual([{ x: 0, y: 0 }])
  })

  it('matches the published J/L/S/T/Z table, flipped for a downward y', () => {
    // Published 0>1 is (0,0) (-1,0) (-1,+1) (0,-2) (-1,-2) with y up.
    expect(kicksFor('T', 0, 1)).toEqual([
      { x: 0, y: 0 },
      { x: -1, y: 0 },
      { x: -1, y: -1 },
      { x: 0, y: 2 },
      { x: -1, y: 2 },
    ])
  })

  it('matches the published I table, flipped for a downward y', () => {
    // Published 0>1 is (0,0) (-2,0) (+1,0) (-2,-1) (+1,+2) with y up.
    expect(kicksFor('I', 0, 1)).toEqual([
      { x: 0, y: 0 },
      { x: -2, y: 0 },
      { x: 1, y: 0 },
      { x: -2, y: 1 },
      { x: 1, y: -2 },
    ])
  })

  it('reverses cleanly: every forward kick has a mirrored return', () => {
    for (const kind of PIECE_KINDS) {
      if (kind === 'O') continue
      for (const from of ROTATIONS) {
        const to = ((from + 1) % 4) as Rotation satisfies Rotation
        const forward = kicksFor(kind, from, to)
        const back = kicksFor(kind, to, from)
        for (let i = 0; i < forward.length; i++) {
          expect(back[i].x).toBe(forward[i].x === 0 ? 0 : -forward[i].x)
          expect(back[i].y).toBe(forward[i].y === 0 ? 0 : -forward[i].y)
        }
      }
    }
  })
})
