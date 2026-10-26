/**
 * APCA lightness contrast (Lc), the 0.0.98G-4g constants.
 *
 * Ported from `apca-w3` by Andrew Somers and Myndex, which is licensed to the
 * W3C for WCAG-compliant use under the W3C Software and Document License. The
 * constants and the polarity convention are the published ones and must stay as
 * they are: light text on a dark background returns a negative number.
 */

const MAIN_TRC = 2.4
const R_COEFFICIENT = 0.2126729
const G_COEFFICIENT = 0.7151522
const B_COEFFICIENT = 0.072175

const NORMAL_BACKGROUND = 0.56
const NORMAL_TEXT = 0.57
const REVERSE_TEXT = 0.62
const REVERSE_BACKGROUND = 0.65

const BLACK_THRESHOLD = 0.022
const BLACK_CLAMP = 1.414
const SCALE = 1.14
const LOW_OFFSET = 0.027
const MIN_DELTA_Y = 0.0005
const LOW_CLIP = 0.1

/** Linear luminance of an sRGB color with channels 0 to 255. */
export function apcaLuminance(r: number, g: number, b: number): number {
  return (
    R_COEFFICIENT * Math.pow(r / 255, MAIN_TRC) +
    G_COEFFICIENT * Math.pow(g / 255, MAIN_TRC) +
    B_COEFFICIENT * Math.pow(b / 255, MAIN_TRC)
  )
}

function softClampBlack(y: number): number {
  return y > BLACK_THRESHOLD
    ? y
    : y + Math.pow(BLACK_THRESHOLD - y, BLACK_CLAMP)
}

/**
 * The signed Lc of text luminance `textY` on background luminance
 * `backgroundY`, both 0 to 1. Dark text on a light background is positive and
 * the reverse is negative, so the arguments must not be swapped.
 */
export function apcaFromLuminance(textY: number, backgroundY: number): number {
  if (
    Number.isNaN(textY) ||
    Number.isNaN(backgroundY) ||
    Math.min(textY, backgroundY) < 0 ||
    Math.max(textY, backgroundY) > 1.1
  ) {
    return 0
  }
  const text = softClampBlack(textY)
  const background = softClampBlack(backgroundY)
  if (Math.abs(background - text) < MIN_DELTA_Y) return 0

  if (background > text) {
    const sapc =
      (Math.pow(background, NORMAL_BACKGROUND) - Math.pow(text, NORMAL_TEXT)) *
      SCALE
    return (sapc < LOW_CLIP ? 0 : sapc - LOW_OFFSET) * 100
  }
  const sapc =
    (Math.pow(background, REVERSE_BACKGROUND) - Math.pow(text, REVERSE_TEXT)) *
    SCALE
  return (sapc > -LOW_CLIP ? 0 : sapc + LOW_OFFSET) * 100
}
