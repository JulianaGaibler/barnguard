import type { Rect } from '@src/stargazer'

/**
 * The arcade's world: two stacked 16:9 regions the camera pans between. The
 * GAME region (top) holds the games; the LAUNCHER region (bottom) holds the
 * launcher chrome. The shared sky gradient spans the whole world.
 *
 * The camera fits a region's 1920×1080 viewport into the canvas
 * aspect-preserving (letterbox). On a narrower-than-16:9 canvas that fit
 * reveals extra world above and below the framed region; if the regions merely
 * touched, that over-draw would bleed one region's content into the other's
 * view. So the vertical GAP between the two regions is made large enough to
 * swallow that over-draw at the current aspect — it is recomputed on resize
 * (see `updateLayout`). The gap is pure sky, so the bleed only ever shows sky,
 * never the neighbor's content.
 */
export const REGION_WIDTH = 1920
export const REGION_HEIGHT = 1080

/** Extra sky buffer beyond the strict over-draw reach (world units). */
const GAP_MARGIN = 60

/**
 * Live layout, mutated by `updateLayout` on resize. Background nodes + the
 * camera framings read these each frame so a resize re-flows without a
 * rebuild.
 */
export const layout = {
  /** World-Y where the launcher region begins. */
  launcherTop: REGION_HEIGHT,
  /** Total world height (launcher region bottom). */
  worldHeight: REGION_HEIGHT * 2,
}

/**
 * Recompute the region separation for the current canvas pixel size. On aspects
 * narrower than 16:9 the camera's vertical over-draw reach is
 * `(REGION_WIDTH/aspect − REGION_HEIGHT)/2`; the gap is set to at least that
 * (plus a margin) so neighbor content never bleeds in.
 */
export function updateLayout(pixelW: number, pixelH: number): void {
  const aspect =
    pixelW > 0 && pixelH > 0 ? pixelW / pixelH : REGION_WIDTH / REGION_HEIGHT
  const reach = Math.max(0, (REGION_WIDTH / aspect - REGION_HEIGHT) / 2)
  const gap = reach + GAP_MARGIN
  layout.launcherTop = REGION_HEIGHT + gap
  layout.worldHeight = layout.launcherTop + REGION_HEIGHT
}

/** Camera framing for the game (top region) — fixed; independent of the gap. */
export function gameView(): Rect {
  return { x: 0, y: 0, width: REGION_WIDTH, height: REGION_HEIGHT }
}

/** Camera framing for the launcher (bottom region) — moves with the gap. */
export function launcherView(): Rect {
  return {
    x: 0,
    y: layout.launcherTop,
    width: REGION_WIDTH,
    height: REGION_HEIGHT,
  }
}

/**
 * The world rect actually visible when the camera is framed on the GAME region,
 * for the given canvas pixel size. Adopts the canvas aspect (the letterbox
 * over-draw), centered on the game region. Games size themselves to this (minus
 * padding) so they fill the screen rather than being locked to 16:9.
 */
export function gameVisibleRect(pixelW: number, pixelH: number): Rect {
  const vw = REGION_WIDTH
  const vh = REGION_HEIGHT
  const scale =
    pixelW > 0 && pixelH > 0 ? Math.min(pixelW / vw, pixelH / vh) : 1
  const visW = pixelW > 0 ? pixelW / scale : vw
  const visH = pixelH > 0 ? pixelH / scale : vh
  return {
    x: vw / 2 - visW / 2,
    y: vh / 2 - visH / 2,
    width: visW,
    height: visH,
  }
}
