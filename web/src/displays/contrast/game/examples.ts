/**
 * The three cards the splash shows to explain the thumbs, one per level.
 *
 * Each pair rates the same under APCA and WCAG, so the splash never teaches an
 * answer that the other algorithm would call wrong. (The two disagree about
 * orange, for one: APCA never rates dark text on it above level 1.) A test
 * holds that. A card is its background and its text color, and the text color
 * is also the color of the thumbs drawn on it.
 */
import {
  ALGORITHMS,
  contrastOf,
  isAmbiguous,
  levelOf,
  type Level,
  type Rgb,
} from './contrast'
import type { Random } from './round'

export interface Example {
  level: Level
  background: Rgb
  text: Rgb
}

/** Top to bottom: poor, acceptable, good. */
export const EXAMPLES: readonly Example[] = [
  { level: 1, background: [246, 163, 121], text: [255, 252, 236] },
  { level: 2, background: [99, 100, 126], text: [255, 252, 236] },
  { level: 3, background: [47, 18, 18], text: [255, 252, 236] },
]

/** The most pairs drawn for one example before the fixed one stands in. */
const MAX_ATTEMPTS = 20_000

/**
 * A poor example still has to show its thumbs, so its text must stand out at
 * least this much from its background, in each algorithm's own terms.
 */
const MIN_VISIBLE_LC = 25
const MIN_VISIBLE_RATIO = 1.4

function visible(background: Rgb, text: Rgb): boolean {
  return (
    Math.abs(contrastOf('apca', background, text)) >= MIN_VISIBLE_LC &&
    contrastOf('wcag', background, text) >= MIN_VISIBLE_RATIO
  )
}

/**
 * A random example of `level` from `colors`, for the splash to cycle through.
 * Like the fixed ones it rates the same under both algorithms and sits clear of
 * every boundary, so whatever the attendant picked, the splash never shows an
 * answer the game would call wrong.
 */
export function newExample(
  colors: readonly Rgb[],
  level: Level,
  random: Random,
): Example {
  const pick = (): Rgb => colors[Math.floor(random() * colors.length)]!
  if (colors.length > 0) {
    for (let attempt = 0; attempt < MAX_ATTEMPTS; attempt++) {
      const background = pick()
      const text = pick()
      const agrees = ALGORITHMS.every((algorithm) => {
        const contrast = contrastOf(algorithm, background, text)
        return (
          !isAmbiguous(algorithm, contrast) &&
          levelOf(algorithm, contrast) === level
        )
      })
      if (agrees && (level !== 1 || visible(background, text))) {
        return { level, background, text }
      }
    }
  }
  return EXAMPLES[level - 1]!
}
