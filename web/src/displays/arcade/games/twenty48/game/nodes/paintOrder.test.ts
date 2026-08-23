import { describe, expect, it } from 'vitest'
import { byPaintOrder, cascadeDelay } from './TileLayerNode'
import { GOAL } from '../tuning'
import { SIZE } from '../types'

/** A stand-in for a tile node, which needs an engine to build for real. */
const at = (y: number) => ({ transform: { y } })

describe('byPaintOrder', () => {
  it('paints higher tiles first so lower ones cover their skirts', () => {
    const tiles = [at(300), at(100), at(200)]
    tiles.sort(byPaintOrder)
    expect(tiles.map((t) => t.transform.y)).toEqual([100, 200, 300])
  })

  it('is stable for tiles sharing a row', () => {
    const a = at(100)
    const b = at(100)
    expect(byPaintOrder(a, b)).toBe(0)
  })

  it('orders by live position, not by settled row', () => {
    // A tile partway through a slide out of row 0 must already sort behind a
    // tile it has passed, or the handover pops.
    const sliding = at(140)
    const settled = at(120)
    expect(byPaintOrder(sliding, settled)).toBeGreaterThan(0)
  })
})

describe('cascadeDelay', () => {
  const at = (col: number, row: number) => row * SIZE + col

  it('pops the winning tile first, with no wait', () => {
    expect(cascadeDelay(at(1, 2), at(1, 2))).toBe(0)
  })

  it('rolls outward, so nearer tiles pop sooner', () => {
    const from = at(0, 0)
    expect(cascadeDelay(from, at(1, 0))).toBeLessThan(
      cascadeDelay(from, at(3, 0)),
    )
    expect(cascadeDelay(from, at(1, 1))).toBeGreaterThan(
      cascadeDelay(from, at(1, 0)),
    )
  })

  it('treats equal grid distance as one step of the wave', () => {
    const from = at(2, 2)
    expect(cascadeDelay(from, at(1, 2))).toBe(cascadeDelay(from, at(2, 1)))
    expect(cascadeDelay(from, at(0, 2))).toBe(cascadeDelay(from, at(2, 0)))
  })

  it('finishes the whole board inside the goal moment', () => {
    // The furthest corner from the opposite corner is six steps on a 4x4.
    const longest = cascadeDelay(at(0, 0), at(SIZE - 1, SIZE - 1))
    expect(longest).toBeCloseTo(GOAL.cascadeStepSec * (SIZE - 1) * 2, 6)
    expect(longest).toBeLessThan(GOAL.rainDurationSec)
  })
})
