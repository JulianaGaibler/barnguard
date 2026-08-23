import { describe, expect, it } from 'vitest'
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
} from './board'
import { bestGain, dealBoard, greedySolve } from './generate'
import { PRESETS } from './tuning'
import type { PresetId } from './types'

const IDS: PresetId[] = ['small', 'medium', 'large']

describe('greedySolve', () => {
  it('floods every board it is given', () => {
    for (let seed = 0; seed < 30; seed++) {
      const board = createBoard(9, 9, 4)
      fillRandom(board, seededRandom(seed))
      seedOwners(board, 1)
      const par = greedySolve(board)
      expect(par).toBeGreaterThan(0)
      expect(par).toBeLessThan(board.color.length)
    }
  })

  it('leaves its input untouched', () => {
    const board = createBoard(8, 8, 4)
    fillRandom(board, seededRandom(4))
    seedOwners(board, 1)
    const colors = board.color.slice()
    const owners = board.owner.slice()
    greedySolve(board)
    expect([...board.color]).toEqual([...colors])
    expect([...board.owner]).toEqual([...owners])
  })

  it('reports 0 for a board that is already one color', () => {
    const board = createBoard(4, 4, 3)
    seedOwners(board, 1)
    expect(isFlooded(board, 1)).toBe(true)
    expect(greedySolve(board)).toBe(0)
  })

  it('is a count a player can actually match', () => {
    // Replaying greedy's own choices has to flood the board in exactly par
    // moves, which is what makes par a usable allowance rather than a guess.
    const board = createBoard(10, 10, 4)
    fillRandom(board, seededRandom(11))
    seedOwners(board, 1)
    const par = greedySolve(board)

    const res = createMoveResult(board)
    const scratch = createBoard(board.cols, board.rows, board.numColors)
    const gains = new Int32Array(board.numColors)
    let moves = 0
    while (!isFlooded(board, 1)) {
      absorbGains(board, 1, scratch, res, gains)
      applyMove(board, 1, bestGain(gains), res)
      moves++
      expect(moves).toBeLessThanOrEqual(par)
    }
    expect(moves).toBe(par)
  })
})

describe('dealBoard', () => {
  it('lands par inside every preset band, across many seeds', () => {
    for (const id of IDS) {
      const preset = PRESETS[id]
      for (let seed = 0; seed < 25; seed++) {
        const { par } = dealBoard(id, seededRandom(seed * 7919 + 1), 1)
        expect(par).toBeGreaterThanOrEqual(preset.parMin)
        expect(par).toBeLessThanOrEqual(preset.parMax)
      }
    }
  })

  it('allows at least par, and no less', () => {
    for (const id of IDS) {
      for (let seed = 0; seed < 10; seed++) {
        const { par, maxMoves } = dealBoard(id, seededRandom(seed + 200), 1)
        expect(maxMoves).toBeGreaterThanOrEqual(par)
        expect(maxMoves).toBe(Math.max(par, Math.ceil(par * PRESETS[id].slack)))
      }
    }
  })

  it('deals the preset grid and color count', () => {
    for (const id of IDS) {
      const preset = PRESETS[id]
      const { board } = dealBoard(id, seededRandom(3), 1)
      expect(board.cols).toBe(preset.cols)
      expect(board.rows).toBe(preset.rows)
      expect(board.numColors).toBe(preset.colors)
      for (const c of board.color) expect(c).toBeLessThan(preset.colors)
    }
  })

  it('is deterministic for a seed', () => {
    const a = dealBoard('medium', seededRandom(77), 1)
    const b = dealBoard('medium', seededRandom(77), 1)
    expect([...a.board.color]).toEqual([...b.board.color])
    expect(a.par).toBe(b.par)
    expect(a.maxMoves).toBe(b.maxMoves)
  })

  it('gets harder across the presets', () => {
    // Averaged rather than compared per seed, since one deal says little.
    const mean = (id: PresetId): number => {
      let total = 0
      for (let seed = 0; seed < 12; seed++) {
        total += dealBoard(id, seededRandom(seed + 500), 1).par
      }
      return total / 12
    }
    const small = mean('small')
    const medium = mean('medium')
    const large = mean('large')
    expect(medium).toBeGreaterThan(small)
    expect(large).toBeGreaterThan(medium)
  })

  it('starts one region for a puzzle and two for a contest', () => {
    const solo = dealBoard('small', seededRandom(5), 1)
    expect(ownedCount(solo.board, 2)).toBe(0)
    expect(ownedCount(solo.board, 1)).toBeGreaterThan(0)

    const versus = dealBoard('small', seededRandom(5), 2)
    expect(ownedCount(versus.board, 1)).toBeGreaterThan(0)
    expect(ownedCount(versus.board, 2)).toBeGreaterThan(0)
  })

  it('never starts a contest with both players in one blob', () => {
    for (let seed = 0; seed < 40; seed++) {
      const { board } = dealBoard('small', seededRandom(seed), 2)
      expect(board.color[0]).not.toBe(board.color[board.color.length - 1])
      // Neither corner may have been claimed by the other player.
      expect(board.owner[0]).toBe(1)
      expect(board.owner[board.owner.length - 1]).toBe(2)
    }
  })
})
