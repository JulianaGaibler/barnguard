/**
 * One round: a background and a text color, and the level they rate at.
 *
 * The level is chosen first and pairs are drawn until one matches, so the three
 * answers come up equally often however the color list is distributed. A pair
 * that sits near a level boundary is thrown away, which keeps every round
 * answerable.
 */
import {
  isAmbiguous,
  contrastOf,
  levelOf,
  LEVELS,
  type Algorithm,
  type Level,
  type Rgb,
} from './contrast'

export type Random = () => number

export interface Round {
  algorithm: Algorithm
  background: Rgb
  text: Rgb
  /** A ratio under WCAG and a signed Lc under APCA. */
  contrast: number
  /** The right answer. */
  level: Level
}

/** The most pairs drawn for one round before settling for any clear pair. */
const MAX_ATTEMPTS = 20_000

/**
 * A new round from `colors`. If no pair of the wanted level turns up within
 * {@link MAX_ATTEMPTS} draws, which a tiny list can cause, the round takes
 * whatever clear pair it found last and rates it honestly.
 */
export function newRound(
  algorithm: Algorithm,
  colors: readonly Rgb[],
  random: Random,
): Round {
  if (colors.length === 0) throw new Error('No colors to draw a round from.')
  const wanted = LEVELS[Math.floor(random() * LEVELS.length)]!
  const pick = (): Rgb => colors[Math.floor(random() * colors.length)]!

  let fallback: Round | null = null
  for (let attempt = 0; attempt < MAX_ATTEMPTS; attempt++) {
    const background = pick()
    const text = pick()
    const contrast = contrastOf(algorithm, background, text)
    if (isAmbiguous(algorithm, contrast)) continue
    const level = levelOf(algorithm, contrast)
    const round: Round = { algorithm, background, text, contrast, level }
    if (level === wanted) return round
    fallback = round
  }
  if (fallback) return fallback
  const background = colors[0]!
  const text = colors[colors.length - 1]!
  const contrast = contrastOf(algorithm, background, text)
  return {
    algorithm,
    background,
    text,
    contrast,
    level: levelOf(algorithm, contrast),
  }
}

/** A generator seeded from `seed`, for a run that has to repeat. */
export function seededRandom(seed: number): Random {
  let s = seed >>> 0
  return () => {
    s = (s * 1664525 + 1013904223) >>> 0
    return s / 2 ** 32
  }
}
