/**
 * A small deterministic pseudo-random generator, shared by the games that need
 * reproducible boards, decks, or searches.
 *
 * @example
 *   const rng = seededRandom(7)
 *   const roll = Math.floor(rng() * 6)
 */

/** A source of numbers in `[0, 1)`, interchangeable with `Math.random`. */
export type Random = () => number

/**
 * A generator seeded from `seed`. The same seed always yields the same
 * sequence, which is what makes a randomized game testable and lets two players
 * share an identical board.
 */
export function seededRandom(seed: number): Random {
  let s = seed >>> 0
  return () => {
    s = (s * 1664525 + 1013904223) >>> 0
    return s / 2 ** 32
  }
}

/**
 * A fresh seed for one run, from the platform generator.
 *
 * The counterpart to {@link seededRandom}: this picks the seed a run is played
 * on, that one turns a seed into the run's sequence. Feed it in once and hold
 * the seed if the run needs to be replayed or shared between two players.
 */
export function randomSeed(): number {
  return Math.floor(Math.random() * 2 ** 31)
}
