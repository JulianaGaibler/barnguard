import { describe, expect, it } from 'vitest'
import { seededRandom } from '../../common/rng'
import { BAG_SIZE, createPieceStream, shuffleBag } from './bag'
import { PIECE_KINDS } from './pieces'

describe('shuffleBag', () => {
  it('returns every shape exactly once', () => {
    const bag = shuffleBag(seededRandom(1))
    expect(bag).toHaveLength(BAG_SIZE)
    expect([...bag].sort()).toEqual([...PIECE_KINDS].sort())
  })

  it('does not just hand back the input order', () => {
    // Weak by nature, but it catches a shuffle that silently does nothing.
    const orders = new Set<string>()
    for (let seed = 0; seed < 20; seed++) {
      orders.add(shuffleBag(seededRandom(seed)).join(''))
    }
    expect(orders.size).toBeGreaterThan(1)
  })

  it('reaches every position for every shape', () => {
    // A Fisher-Yates that walks the wrong direction pins one element in place.
    // Drawn from one running generator rather than from many seeds, which is
    // both how a real run consumes it and a fair test of the shuffle instead of
    // of the generator's seed diffusion.
    const random = seededRandom(1)
    const seen = PIECE_KINDS.map(() => new Set<number>())
    for (let bag = 0; bag < 200; bag++) {
      shuffleBag(random).forEach((kind, i) => {
        seen[PIECE_KINDS.indexOf(kind)].add(i)
      })
    }
    for (const positions of seen) expect(positions.size).toBe(BAG_SIZE)
  })
})

describe('piece stream', () => {
  it('never repeats a shape within a bag', () => {
    const stream = createPieceStream(42)
    for (let bag = 0; bag < 12; bag++) {
      const drawn = new Set<string>()
      for (let i = 0; i < BAG_SIZE; i++)
        drawn.add(stream.at(bag * BAG_SIZE + i))
      expect(drawn.size).toBe(BAG_SIZE)
    }
  })

  it('never puts more than twelve pieces between two of the same shape', () => {
    // The worst case is a shape first in one bag and last in the next.
    const stream = createPieceStream(7)
    const lastSeen = new Map<string, number>()
    for (let i = 0; i < 700; i++) {
      const kind = stream.at(i)
      const prev = lastSeen.get(kind)
      if (prev !== undefined) expect(i - prev).toBeLessThanOrEqual(13)
      lastSeen.set(kind, i)
    }
  })

  it('answers out of order with the same sequence', () => {
    // The next queue reads ahead of the piece in play, so a later ordinal must
    // not disturb the earlier ones.
    const forward = createPieceStream(99)
    const inOrder = Array.from({ length: 30 }, (_, i) => forward.at(i))

    const jumbled = createPieceStream(99)
    jumbled.at(29)
    jumbled.at(4)
    const outOfOrder = Array.from({ length: 30 }, (_, i) => jumbled.at(i))

    expect(outOfOrder).toEqual(inOrder)
  })

  it('gives two seats the same sequence from one seed', () => {
    // This is what makes the race a race rather than two unrelated games.
    const a = createPieceStream(2024)
    const b = createPieceStream(2024)
    // Seats run at different speeds, so they reach different ordinals.
    for (let i = 0; i < 40; i++) a.at(i)
    for (let i = 0; i < 15; i++) b.at(i)
    for (let i = 0; i < 40; i++) expect(b.at(i)).toBe(a.at(i))
  })

  it('gives different seeds different sequences', () => {
    const a = createPieceStream(1)
    const b = createPieceStream(2)
    const same = Array.from({ length: 40 }, (_, i) => a.at(i) === b.at(i))
    expect(same.every(Boolean)).toBe(false)
  })
})
