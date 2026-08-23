import { describe, expect, it } from 'vitest'
import { createSpawnStream } from './spawn'
import { createStartState, emptyIndices, move, spawnTile } from './rules'
import type { Direction } from './types'
import { RULES } from './tuning'

describe('createSpawnStream', () => {
  it('gives the same sequence for the same seed', () => {
    const a = createSpawnStream(1234)
    const b = createSpawnStream(1234)
    for (let i = 0; i < 100; i++) expect(a.at(i)).toEqual(b.at(i))
  })

  it('gives different sequences for different seeds', () => {
    const a = createSpawnStream(1)
    const b = createSpawnStream(2)
    const differs = Array.from({ length: 20 }, (_, i) => i).some(
      (i) =>
        a.at(i).value !== b.at(i).value ||
        a.at(i).slotFrac !== b.at(i).slotFrac,
    )
    expect(differs).toBe(true)
  })

  it('is order-independent', () => {
    const forward = createSpawnStream(99)
    const inOrder = Array.from({ length: 30 }, (_, i) => forward.at(i))
    const jumped = createSpawnStream(99)
    // Reading ordinal 29 first must not change what ordinal 0 returns.
    expect(jumped.at(29)).toEqual(inOrder[29])
    for (let i = 0; i < 30; i++) expect(jumped.at(i)).toEqual(inOrder[i])
  })

  it('draws fours at roughly the configured rate', () => {
    const stream = createSpawnStream(4242)
    let fours = 0
    const n = 10_000
    for (let i = 0; i < n; i++) if (stream.at(i).value === 4) fours++
    expect(fours / n).toBeCloseTo(RULES.fourChance, 1)
  })

  it('keeps slot fractions inside the unit interval', () => {
    const stream = createSpawnStream(5)
    for (let i = 0; i < 500; i++) {
      const { slotFrac } = stream.at(i)
      expect(slotFrac).toBeGreaterThanOrEqual(0)
      expect(slotFrac).toBeLessThan(1)
    }
  })
})

describe('shared stream across two boards', () => {
  /** Play `moves` against a fresh board off `stream`, spawning as the game does. */
  function play(
    stream: ReturnType<typeof createSpawnStream>,
    moves: Direction[],
  ) {
    let state = createStartState(stream)
    const consumed: number[] = [0, 1]
    for (const dir of moves) {
      const result = move(state, dir)
      if (!result.moved) continue
      consumed.push(result.state.spawnOrdinal)
      state = spawnTile(result.state, stream).state
    }
    return { state, consumed }
  }

  it('deals both players an identical opening board', () => {
    const seed = 20_480
    const a = createStartState(createSpawnStream(seed))
    const b = createStartState(createSpawnStream(seed))
    expect(a.tiles).toEqual(b.tiles)
  })

  it('feeds divergent boards the same draw per ordinal', () => {
    // The whole point of carrying a fraction rather than a cell: the two
    // players move differently from the first turn, so their empty lists
    // diverge immediately, and neither may knock the other off the stream.
    const seed = 777
    const streamA = createSpawnStream(seed)
    const streamB = createSpawnStream(seed)
    const a = play(streamA, ['left', 'up', 'left', 'up', 'left', 'down'])
    const b = play(streamB, ['right', 'down', 'right', 'left', 'up', 'right'])

    const shared = Math.min(a.consumed.length, b.consumed.length)
    for (let i = 0; i < shared; i++) {
      expect(a.consumed[i]).toBe(b.consumed[i])
      expect(streamA.at(a.consumed[i])).toEqual(streamB.at(b.consumed[i]))
    }
    // And they really did diverge, so the check above is not vacuous.
    expect(a.state.tiles).not.toEqual(b.state.tiles)
  })

  it('resolves a slot fraction against whatever cells are free', () => {
    const stream = createSpawnStream(31)
    let state = createStartState(stream)
    for (let i = 0; i < 12; i++) {
      const before = emptyIndices(state)
      if (before.length === 0) break
      const { state: next, tile } = spawnTile(state, stream)
      expect(before).toContain(tile?.index)
      state = next
    }
  })
})
