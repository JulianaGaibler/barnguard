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

/** Windows this many CSS pixels wide or wider use the cell size as given. */
const FULL_CELL_WIDTH = 1100
/** Windows this many CSS pixels wide or narrower use the smallest cell. */
const SMALL_CELL_WIDTH = 400
/** The share of its size a cell keeps on the narrowest windows. */
const SMALL_CELL_SHARE = 0.5

/**
 * How much of its size a cell keeps in a window `cssWidth` CSS pixels wide. A
 * phone shows the same field on a fraction of the pixels, so cells as big as a
 * monitor's read as coarse there.
 */
export function cellShare(cssWidth: number): number {
  const k = Math.min(
    Math.max(
      (cssWidth - SMALL_CELL_WIDTH) / (FULL_CELL_WIDTH - SMALL_CELL_WIDTH),
      0,
    ),
    1,
  )
  return SMALL_CELL_SHARE + (1 - SMALL_CELL_SHARE) * k
}

/**
 * Keeps the cells of `fx` the same size on screen. The looks below give cell
 * sizes in design pixels, which are CSS pixels on a 1920 wide window. On a
 * smaller screen the frame is scaled down, so the layer's cell size is
 * multiplied by the design pixels in one CSS pixel.
 */
export class FixedCells {
  readonly #fx: Dither
  #design: number
  #cssPxInWorld = 1
  #share = 1

  constructor(fx: Dither) {
    this.#fx = fx
    this.#design = fx.settings.cellSize
  }

  /** Sets the cell size, in CSS pixels, to keep from now on. */
  setDesign(size: number): void {
    this.#design = size
    this.apply(this.#cssPxInWorld)
  }

  /**
   * Sizes the cells for a screen with `cssPxInWorld` design pixels per CSS
   * pixel. With `cssWidth`, the window's width in CSS pixels, the cells also
   * shrink on a narrow window, see {@link cellShare}. Without it the share from
   * the last call stays.
   */
  apply(cssPxInWorld: number, cssWidth?: number): void {
    this.#cssPxInWorld = cssPxInWorld
    if (cssWidth !== undefined) this.#share = cellShare(cssWidth)
    this.#fx.settings.cellSize = this.#design * this.#share * cssPxInWorld
  }
}

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
