/**
 * The piece sequence: all seven shapes shuffled, then all seven again, so a
 * player is never starved of the one they are building for and never handed
 * four of the same in a row.
 *
 * Indexed by ordinal rather than consumed as a stream, and memoized, so `at(n)`
 * is answerable in any order and always gives the same answer. Two things need
 * that. The next queue reads several pieces ahead of the one in play, and a
 * two-player race hands both seats the same stream: each keeps its own ordinal,
 * so a player further along is simply further into the same sequence, and the
 * two can never drift.
 *
 * @example
 *   const stream = createPieceStream(seed)
 *   const current = stream.at(0)
 *   const queue = [1, 2, 3, 4, 5].map((i) => stream.at(i))
 */
import { seededRandom, type Random } from '../../common/rng'
import { PIECE_KINDS } from './pieces'
import type { PieceKind } from './types'

export const BAG_SIZE = 7

/** A reproducible, randomly addressable sequence of shapes. */
export interface PieceStream {
  /** The shape at `ordinal`, counting from zero. */
  at(ordinal: number): PieceKind
}

/** One bag: every shape once, in a shuffled order. */
export function shuffleBag(random: Random): PieceKind[] {
  const bag = [...PIECE_KINDS]
  // Fisher-Yates, so every ordering is equally likely. A sort with a random
  // comparator is not: it biases toward the input order.
  for (let i = bag.length - 1; i > 0; i--) {
    const j = Math.floor(random() * (i + 1))
    ;[bag[i], bag[j]] = [bag[j], bag[i]]
  }
  return bag
}

/**
 * Draws discarded before the first bag.
 *
 * The shared generator is a linear congruential one, so its first output is a
 * linear function of the seed and two nearby seeds open near-identically. A
 * short warm-up decorrelates them, which matters because a seed here can come
 * from anywhere, including a counter.
 */
const WARMUP_DRAWS = 8

export function createPieceStream(seed: number): PieceStream {
  const random = seededRandom(seed)
  for (let i = 0; i < WARMUP_DRAWS; i++) random()
  const drawn: PieceKind[] = []
  return {
    at(ordinal: number): PieceKind {
      // Generated in bag-sized blocks, because the shuffle for bag N depends on
      // every draw before it. Reading far ahead fills the gap rather than
      // skipping it, which is what keeps the sequence stable.
      while (drawn.length <= ordinal) drawn.push(...shuffleBag(random))
      return drawn[ordinal]
    },
  }
}
