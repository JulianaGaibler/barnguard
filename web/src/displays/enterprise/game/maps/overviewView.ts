import type { Rect } from 'stargazer'

/**
 * The splash draws the map a little taller than the view. It bleeds past the
 * top and bottom edges, so it reads as a landmass rather than a picture fitted
 * into a frame.
 */
export const SPLASH_MAP_HEIGHT_OVER_VIEW = 1.0803

/**
 * The picker draws the whole map with a margin around it, so a region on the
 * map's edge and the disc drawn over a small one stay in view to be tapped.
 */
export const PICKER_MAP_HEIGHT_OVER_VIEW = 0.9

/**
 * The widest the map may be, as a fraction of the view's width. At 16:9 the
 * height fit lands at about 59%. A squarer window would push that higher and
 * run the map under the text column on the left, so past this the view widens
 * instead.
 */
const MAX_MAP_WIDTH_FRAC = 0.62

/**
 * The map-space rect to frame while the splash or the picker is up: the map
 * vertically centred at `mapHeightOverView` times the view's height and against
 * the right of the view, with the left of the view left free for text. A map
 * shorter than the view keeps the same margin on the right as above and below.
 *
 * `aspect` is the canvas's width over height. The rect is built to that aspect
 * so a camera fitting it to the canvas shows exactly this and nothing more.
 *
 * @example
 *   const target = overviewView(map.idleView, canvasWidth / canvasHeight)
 *   await camera.animateTo(target, { duration: 0.6 })
 */
export function overviewView(
  map: Rect,
  aspect: number,
  mapHeightOverView: number = SPLASH_MAP_HEIGHT_OVER_VIEW,
): Rect {
  const safeAspect = aspect > 0 ? aspect : 16 / 9
  let height = map.height / mapHeightOverView
  const rightMargin = Math.max(0, (height - map.height) / 2)
  let width = height * safeAspect
  if (map.width / width > MAX_MAP_WIDTH_FRAC) {
    width = map.width / MAX_MAP_WIDTH_FRAC
    height = width / safeAspect
  }
  return {
    x: map.x + map.width + rightMargin - width,
    y: map.y + map.height / 2 - height / 2,
    width,
    height,
  }
}
