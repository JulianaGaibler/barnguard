import type { Rect } from '@src/stargazer'

/** The size every screen is designed at, in world units. */
export const DESIGN_WIDTH = 1920
export const DESIGN_HEIGHT = 1080

/**
 * The world rect a UI camera sees for a canvas of the given pixel size, with
 * the design region fitted inside it and centred.
 *
 * The fit is aspect preserving, so on anything but 16:9 the rect reaches past
 * the design region on one axis: wider on a wide window, taller on a tall one.
 * Layout reads this rect rather than the design constants, so a screen fills
 * the window at any shape.
 */
export function visibleRect(pixelW: number, pixelH: number): Rect {
  const scale =
    pixelW > 0 && pixelH > 0
      ? Math.min(pixelW / DESIGN_WIDTH, pixelH / DESIGN_HEIGHT)
      : 1
  const width = pixelW > 0 ? pixelW / scale : DESIGN_WIDTH
  const height = pixelH > 0 ? pixelH / scale : DESIGN_HEIGHT
  return {
    x: DESIGN_WIDTH / 2 - width / 2,
    y: DESIGN_HEIGHT / 2 - height / 2,
    width,
    height,
  }
}

/**
 * World units per CSS pixel while the design region is framed, for a size that
 * has to stay fixed on screen, such as a tap target, whatever the window does.
 */
export function worldPerCssPx(cssW: number, cssH: number): number {
  const scale = Math.min(cssW / DESIGN_WIDTH, cssH / DESIGN_HEIGHT)
  return scale > 0 ? 1 / scale : 1
}
