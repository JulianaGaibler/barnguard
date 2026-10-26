/**
 * Contrast of a text color on a background under WCAG 2 or APCA, and the three
 * levels the game rates it into.
 *
 * Both algorithms map onto the same levels, so the rest of the display never
 * branches on which one is playing: 1 is a poor pair, 2 is acceptable and 3 is
 * good. The thresholds follow the rating the website's contrast game uses.
 */
import { apcaFromLuminance, apcaLuminance } from './apca'

export const ALGORITHMS = ['apca', 'wcag'] as const
export type Algorithm = (typeof ALGORITHMS)[number]

export const DEFAULT_ALGORITHM: Algorithm = 'apca'

/** An sRGB color, channels 0 to 255. */
export type Rgb = readonly [number, number, number]

/** 1 is a poor pair, 2 is acceptable and 3 is good. */
export type Level = 1 | 2 | 3

export const LEVELS: readonly Level[] = [1, 2, 3]

/** WCAG 2 ratios for AA body text and for AAA. */
const WCAG_AA = 4.5
const WCAG_AAA = 7
/** How near a WCAG ratio can sit to a threshold before the pair is a coin toss. */
const WCAG_AMBIGUITY = 0.25

/** The Lc of the top level. The middle level starts 15 percent below it. */
const APCA_TOP = 90
const APCA_MIDDLE = APCA_TOP * 0.85
/** How near an Lc can sit to a threshold before the pair is a coin toss. */
const APCA_AMBIGUITY = 5

function wcagLuminance([r, g, b]: Rgb): number {
  const linear = [r, g, b].map((channel) => {
    const v = channel / 255
    return v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4)
  })
  return linear[0]! * 0.2126 + linear[1]! * 0.7152 + linear[2]! * 0.0722
}

/** The WCAG 2 contrast ratio of two colors, 1 to 21, in either order. */
export function wcagContrast(a: Rgb, b: Rgb): number {
  const la = wcagLuminance(a)
  const lb = wcagLuminance(b)
  return (Math.max(la, lb) + 0.05) / (Math.min(la, lb) + 0.05)
}

/** The signed APCA Lc of `text` on `background`. */
export function apcaContrast(background: Rgb, text: Rgb): number {
  return apcaFromLuminance(apcaLuminance(...text), apcaLuminance(...background))
}

/**
 * The contrast of `text` on `background` under `algorithm`. A ratio for WCAG
 * and a signed Lc for APCA, so compare it only with {@link levelOf} and
 * {@link isAmbiguous}.
 */
export function contrastOf(
  algorithm: Algorithm,
  background: Rgb,
  text: Rgb,
): number {
  return algorithm === 'wcag'
    ? wcagContrast(background, text)
    : apcaContrast(background, text)
}

/** The level a contrast falls in. */
export function levelOf(algorithm: Algorithm, contrast: number): Level {
  if (algorithm === 'wcag') {
    if (contrast >= WCAG_AAA) return 3
    return contrast >= WCAG_AA ? 2 : 1
  }
  const lc = Math.abs(contrast)
  if (lc >= APCA_TOP) return 3
  return lc >= APCA_MIDDLE ? 2 : 1
}

/**
 * Whether a contrast sits close enough to a level boundary that a player could
 * fairly call it either way. Rounds never use such a pair.
 */
export function isAmbiguous(algorithm: Algorithm, contrast: number): boolean {
  if (algorithm === 'wcag') {
    return (
      Math.abs(contrast - WCAG_AAA) < WCAG_AMBIGUITY ||
      Math.abs(contrast - WCAG_AA) < WCAG_AMBIGUITY
    )
  }
  const lc = Math.abs(contrast)
  return (
    Math.abs(lc - APCA_TOP) < APCA_AMBIGUITY ||
    Math.abs(lc - APCA_MIDDLE) < APCA_AMBIGUITY
  )
}

/** A color as a CSS `rgb()` string. */
export function cssColor([r, g, b]: Rgb): string {
  return `rgb(${r}, ${g}, ${b})`
}
