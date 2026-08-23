/**
 * The spawn stream: where new tiles come from, and the reason two players can
 * race the same deal.
 *
 * A stream is a seeded, memoized sequence of draws indexed by spawn ordinal.
 * Both boards in a versus match share one stream, so the nth tile either player
 * receives has the same value and lands in the same relative position.
 *
 * The important detail is that a draw carries a FRACTION rather than a cell
 * index. `spawnTile` resolves it against that board's own empty list, so once
 * the two boards diverge (as they immediately do, since the players move
 * differently) neither desyncs the other: each still consumes ordinal 7's draw
 * as ordinal 7, over whatever empty cells it happens to have. Handing out
 * absolute cells instead would break the moment the boards stopped matching.
 *
 * @example
 *   const stream = createSpawnStream(seed)
 *   const { value, slotFrac } = stream.at(0)
 */
import { seededRandom } from '../../common/rng'
import { RULES } from './tuning'

/** One tile's worth of randomness. */
export interface SpawnDraw {
  value: 2 | 4
  /** Position in `[0, 1)`, resolved against a board's own empty cells. */
  slotFrac: number
}

export interface SpawnStream {
  /** The draw for `ordinal`. Pure: the same ordinal always gives the same draw. */
  at(ordinal: number): SpawnDraw
}

/**
 * A stream from `seed`. Draws are generated lazily and cached, so `at` is
 * order-independent and can be called for the same ordinal any number of
 * times.
 */
export function createSpawnStream(
  seed: number,
  fourChance: number = RULES.fourChance,
): SpawnStream {
  const rand = seededRandom(seed)
  const draws: SpawnDraw[] = []
  return {
    at(ordinal: number): SpawnDraw {
      while (draws.length <= ordinal) {
        // Value first, then position, so the two draws stay in a fixed order.
        const value = rand() < fourChance ? 4 : 2
        draws.push({ value, slotFrac: rand() })
      }
      return draws[ordinal]
    },
  }
}

/** A fresh seed for a run. */
export function randomSeed(): number {
  return Math.floor(Math.random() * 2 ** 31)
}
