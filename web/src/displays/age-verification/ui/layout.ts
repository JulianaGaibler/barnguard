import type { Rect } from '@src/stargazer'
import { DESIGN_HEIGHT, DESIGN_WIDTH } from '@src/core/ui/designRegion'

/** Width of the row the screens' content sits in, in design pixels. */
export const ROW_WIDTH = 1664
/** The least space left and right of the row. */
const MIN_MARGIN = 128
/** Space between the two columns of the row. */
export const COLUMN_GAP = 128
/** Where the progress row starts, from the top. */
export const TRAIL_TOP = 63
/** Space above and below the content, from the top and bottom edge. */
const CONTENT_TOP = 159
const CONTENT_BOTTOM = 161
/** The button row, and the space under it. */
export const NAV_HEIGHT = 64
const NAV_BOTTOM = DESIGN_HEIGHT - 951 - NAV_HEIGHT

/** A box, from the top left of the visible area, in design pixels. */
export type Box = Pick<Rect, 'x' | 'y' | 'width' | 'height'>

/** Where everything on a screen goes, for one visible area. */
export interface ScreenLayout {
  /** The visible area. */
  width: number
  height: number
  /** The row the content sits in, centered. */
  rowX: number
  rowWidth: number
  trailY: number
  navY: number
  /** The row of two columns, between the progress row and the buttons. */
  content: Box
  /** The text column, on the left. */
  left: Box
  /** The column for the picture, the animation or the answers, on the right. */
  right: Box
}

/**
 * Lays the screens out in a visible area of `width` by `height` design pixels,
 * which `visibleRect` gives: at least 1920 by 1080, and larger on one axis when
 * the window is not 16:9.
 *
 * The distances to the edges stay as designed. The progress row hugs the top,
 * the buttons hug the bottom, and the row stays 1664 wide in the middle. Extra
 * width becomes margin and extra height goes to the content, whose columns
 * center their contents. At exactly 16:9 every number is the design's.
 */
export function layoutFor(width: number, height: number): ScreenLayout {
  const rowWidth = Math.min(ROW_WIDTH, Math.max(width - MIN_MARGIN * 2, 0))
  const rowX = (width - rowWidth) / 2
  const columnWidth = (rowWidth - COLUMN_GAP) / 2
  const content: Box = {
    x: rowX,
    y: CONTENT_TOP,
    width: rowWidth,
    height: Math.max(height - CONTENT_TOP - CONTENT_BOTTOM, 0),
  }
  return {
    width,
    height,
    rowX,
    rowWidth,
    trailY: TRAIL_TOP,
    navY: height - NAV_BOTTOM - NAV_HEIGHT,
    content,
    left: { ...content, width: columnWidth },
    right: {
      ...content,
      x: rowX + columnWidth + COLUMN_GAP,
      width: columnWidth,
    },
  }
}

/** The layout of the design frame itself, which is 16:9. */
export const DESIGN_LAYOUT = layoutFor(DESIGN_WIDTH, DESIGN_HEIGHT)

/** `box` moved from the visible area's corner to the world's origin. */
export function inWorld(box: Box, area: Pick<Rect, 'x' | 'y'>): Box {
  return { ...box, x: box.x + area.x, y: box.y + area.y }
}
