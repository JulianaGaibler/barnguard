import {
  Dither,
  ditherPreset,
  type DitherSettings,
} from '@src/core/render/dither'
import type { IllustrationDither } from '../story/types'
import { PALETTE } from '../theme'

/**
 * How the display's art is dithered. The colors are the display palette, and
 * the patterns and sizes are placeholders until the design settles.
 */

/** The corner fields behind the screens: sparse red dots on white. */
export function backgroundDither(): Dither {
  return new Dither(
    ditherPreset('stippleCloud', {
      cellSize: 8,
      dotScale: 0.8,
      invert: true,
      gamma: 1.3,
      paper: PALETTE.white,
      ink: PALETTE.red,
    }),
  )
}

/**
 * The orange spot a moment lights, over the red field. It draws only its dots
 * and leaves the ground clear, so the red shows through between them.
 */
export function accentDither(): Dither {
  return new Dither(
    ditherPreset('stippleCloud', {
      cellSize: 8,
      dotScale: 0.8,
      invert: true,
      gamma: 1.3,
      paper: 'rgba(255, 255, 255, 0)',
      ink: PALETTE.orange,
    }),
  )
}

/**
 * An illustration: ordered dither in red on a clear ground, so only the art is
 * drawn and the background shows between its dots.
 */
export function illustrationDither(): Dither {
  return new Dither(
    ditherPreset('stageMountain', {
      cellSize: 5,
      dotScale: 0.85,
      alphaThreshold: 0.5,
      invert: true,
      paper: 'rgba(255, 255, 255, 0)',
      ink: PALETTE.black,
    }),
  )
}

/** The splash animation, in the same two colors as an illustration. */
export function splashDither(): Dither {
  return new Dither(
    ditherPreset('stageMountain', {
      cellSize: 5,
      dotScale: 0.85,
      alphaThreshold: 0.5,
      invert: true,
      paper: 'rgba(255, 255, 255, 0)',
      ink: PALETTE.red,
    }),
  )
}

/**
 * The settings an illustration is dithered with: the display's look under
 * `choice`. A preset name takes the whole preset, and an object changes only
 * the settings it names.
 */
export function illustrationSettings(
  base: DitherSettings,
  choice: IllustrationDither | undefined,
): DitherSettings {
  if (choice === undefined) return { ...base }
  if (typeof choice === 'string') return { ...base, ...ditherPreset(choice) }
  return { ...base, ...choice }
}
