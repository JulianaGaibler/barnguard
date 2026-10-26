import type { Rect } from 'stargazer'

/** The height of the frame, which the screens are drawn for. */
const FRAME_HEIGHT = 1080
/** The narrowest frame, the 4:3 of an iPad. */
export const MIN_FRAME_WIDTH = 1440
/** The widest frame. A window wider than this shows more margin. */
const MAX_FRAME_WIDTH = 2400

/**
 * The frame the layer fits into a canvas of `cssW` by `cssH` CSS pixels, in
 * design pixels. Always 1080 high and as wide as the window is, from 4:3 up to
 * 2400. A window narrower than 4:3, such as a portrait iPad, gets the 4:3 frame
 * with bars, so the cards never stack.
 */
export function pickFrame(cssW: number, cssH: number): Rect {
  const aspect =
    cssW > 0 && cssH > 0 ? cssW / cssH : MIN_FRAME_WIDTH / FRAME_HEIGHT
  const width = Math.min(
    Math.max(FRAME_HEIGHT * aspect, MIN_FRAME_WIDTH),
    MAX_FRAME_WIDTH,
  )
  return { x: 0, y: 0, width, height: FRAME_HEIGHT }
}
