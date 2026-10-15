/** One character of a readout, and whether it is drawn dimmed. */
export interface MonoChar {
  char: string
  dim: boolean
}

/**
 * The widest digit advance of each Mozilla face, in em. A readout draws every
 * digit in a cell this wide so a changing number never shifts. The faces carry
 * no tabular figures and their digits run from about 0.46 to 0.69 of the
 * widest, so the width is fixed here rather than asked of the font. Each value
 * is the same at every weight of its family.
 */
export const DIGIT_CELL_EM = {
  text: 0.687,
  headline: 0.66,
  headlineCondensed: 0.468,
  headlineExtended: 0.782,
} as const

export type MonoFamily = keyof typeof DIGIT_CELL_EM

/** Digits a score is padded to. A larger score shows all of its digits. */
export const SCORE_DIGITS = 3

/**
 * A score as characters, zero padded to three digits with the padding marked
 * dim. The last digit is never dim, so a score of zero reads `00` dimmed and a
 * bright `0`.
 *
 * A non-finite or negative score reads as zero, and a fractional one is
 * truncated.
 *
 * @example
 *   splitScore(7) // 0 0 7, the first two dim
 *   splitScore(1204) // 1 2 0 4, none dim
 */
export function splitScore(score: number): MonoChar[] {
  const whole = Number.isFinite(score) ? Math.max(0, Math.trunc(score)) : 0
  const text = String(whole).padStart(SCORE_DIGITS, '0')
  const padding = text.length - String(whole).length
  return Array.from(text, (char, i) => ({ char, dim: i < padding }))
}

/**
 * Any text as characters with none dim, for a timer or a leaderboard position
 * that wants the same fixed digit cells.
 */
export function monoChars(text: string): MonoChar[] {
  return Array.from(text, (char) => ({ char, dim: false }))
}

/** Whether `char` is a digit that gets a fixed cell. */
export function isDigit(char: string): boolean {
  return char >= '0' && char <= '9'
}
