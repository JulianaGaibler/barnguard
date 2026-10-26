import type { Rect } from 'stargazer'

/** The height of the frame on a window wider than tall. */
const COLUMNS_HEIGHT = 1080
const COLUMNS_MIN_WIDTH = 1440
const COLUMNS_MAX_WIDTH = 1920

/** The width of the frame on a window taller than wide. */
const STACK_WIDTH = 960
/** Leaves room for four answers under the text. */
const STACK_MIN_HEIGHT = 1600
const STACK_MAX_HEIGHT = 2080

/**
 * The frame every layer of the display fits into a canvas of `cssW` by `cssH`
 * CSS pixels, in design pixels. A window wider than tall gets a frame 1080
 * high, and a taller one gets a frame 960 wide. Within its limits the frame
 * takes the window's shape, so the text and the answers stay a readable size on
 * an iPad or a phone instead of shrinking with a 1920 wide design.
 */
export function pickFrame(cssW: number, cssH: number): Rect {
  if (cssW <= 0 || cssH <= 0) {
    return { x: 0, y: 0, width: COLUMNS_MAX_WIDTH, height: COLUMNS_HEIGHT }
  }
  const aspect = cssW / cssH
  if (aspect >= 1) {
    return {
      x: 0,
      y: 0,
      width: clamp(
        COLUMNS_HEIGHT * aspect,
        COLUMNS_MIN_WIDTH,
        COLUMNS_MAX_WIDTH,
      ),
      height: COLUMNS_HEIGHT,
    }
  }
  return {
    x: 0,
    y: 0,
    width: STACK_WIDTH,
    height: clamp(STACK_WIDTH / aspect, STACK_MIN_HEIGHT, STACK_MAX_HEIGHT),
  }
}

/** Whether a frame from {@link pickFrame} lays the screens out in one column. */
export function isStacked(frame: Pick<Rect, 'width' | 'height'>): boolean {
  return frame.width < frame.height
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(Math.max(value, min), max)
}
