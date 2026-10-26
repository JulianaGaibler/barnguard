/** Fonts and text helpers for the nodes, so every label is set the same way. */
import { textAdvance, type Canvas } from 'stargazer'
import { FAMILIES, fontWith } from '@src/core/theme/fonts'

/** Body and interface type: Mozilla Text SemiBold. */
export function textFont(sizePx: number): string {
  return fontWith(FAMILIES.mozillaText, 600, sizePx)
}

/** Display type: Mozilla Headline Condensed SemiBold. */
export function headlineFont(sizePx: number): string {
  return fontWith(FAMILIES.mozillaHeadlineCondensed, 600, sizePx)
}

/** The height of a capital as a share of the font size. */
export const CAP_HEIGHT = 0.7

export interface TrackedStyle {
  font: string
  color: string
  /** Space added after every letter, in design pixels. */
  tracking: number
}

/**
 * Draws `text` one letter at a time with `tracking` between them, since the
 * engine sets no letter spacing. `align` places the whole run around `x`. The
 * letters are tinted, so every color they are drawn in shares their bitmaps.
 */
export function fillTracked(
  canvas: Canvas,
  text: string,
  x: number,
  y: number,
  style: TrackedStyle,
  align: 'left' | 'center' | 'right' = 'left',
): void {
  const letters = Array.from(text)
  const advances = letters.map((l) => textAdvance(l, style.font))
  const total =
    advances.reduce((sum, a) => sum + a, 0) +
    style.tracking * Math.max(letters.length - 1, 0)
  let at = align === 'left' ? x : align === 'center' ? x - total / 2 : x - total
  letters.forEach((letter, i) => {
    if (letter !== ' ') {
      canvas.fillText(letter, at, y, {
        font: style.font,
        color: style.color,
        baseline: 'alphabetic',
        tint: true,
      })
    }
    at += advances[i]! + style.tracking
  })
}

/** The width {@link fillTracked} sets `text` in. */
export function trackedWidth(
  text: string,
  font: string,
  tracking: number,
): number {
  const letters = Array.from(text)
  return (
    letters.reduce((sum, l) => sum + textAdvance(l, font), 0) +
    tracking * Math.max(letters.length - 1, 0)
  )
}
