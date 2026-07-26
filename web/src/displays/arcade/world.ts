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

/** Extra sky buffer beyond the strict region separation (world units). */
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
 * Recompute the region separation for the current canvas pixel size so neither
 * region's content can appear in the other's view at any aspect. The
 * center-to-center distance is held to at least one region's visible
 * half-height plus the neighbor's content half-height (plus a sky margin). A
 * region's content can fill a cover rect at the region aspect — the menu
 * preview does — which overflows the visible rect vertically on wide aspects,
 * so the separation tracks that cover extent rather than a near-16:9 constant.
 */
export function updateLayout(pixelW: number, pixelH: number): void {
  const scale =
    pixelW > 0 && pixelH > 0
      ? Math.min(pixelW / REGION_WIDTH, pixelH / REGION_HEIGHT)
      : 1
  const visW = pixelW > 0 ? pixelW / scale : REGION_WIDTH
  const visH = pixelH > 0 ? pixelH / scale : REGION_HEIGHT
  // Height of a cover rect at the region aspect over the visible rect (see
  // `coverView`): equals `visH` on tall aspects, exceeds it on wide ones.
  const coverH = Math.max((visW * REGION_HEIGHT) / REGION_WIDTH, visH)
  const gap = Math.max(0, (visH + coverH) / 2 - REGION_HEIGHT) + GAP_MARGIN
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
 * The world rect actually visible when the camera frames a region centered at
 * `(REGION_WIDTH / 2, centerY)`, for the given canvas pixel size. It adopts the
 * canvas aspect (the letterbox over-draw), so on any non-16:9 window it is
 * wider or taller than a region. This is the arcade's responsive coordinate
 * space: overlays and games size themselves to it so they fill the screen at
 * any aspect instead of being locked to 16:9.
 */
function regionVisibleRect(
  centerY: number,
  pixelW: number,
  pixelH: number,
): Rect {
  const vw = REGION_WIDTH
  const vh = REGION_HEIGHT
  const scale =
    pixelW > 0 && pixelH > 0 ? Math.min(pixelW / vw, pixelH / vh) : 1
  const visW = pixelW > 0 ? pixelW / scale : vw
  const visH = pixelH > 0 ? pixelH / scale : vh
  return {
    x: REGION_WIDTH / 2 - visW / 2,
    y: centerY - visH / 2,
    width: visW,
    height: visH,
  }
}

/**
 * Visible world rect when the camera frames the GAME region (adopts canvas
 * aspect).
 */
export function gameVisibleRect(pixelW: number, pixelH: number): Rect {
  return regionVisibleRect(REGION_HEIGHT / 2, pixelW, pixelH)
}

/**
 * Visible world rect when the camera frames the LAUNCHER region (adopts canvas
 * aspect).
 */
export function launcherVisibleRect(pixelW: number, pixelH: number): Rect {
  return regionVisibleRect(
    layout.launcherTop + REGION_HEIGHT / 2,
    pixelW,
    pixelH,
  )
}

/**
 * A rect of the given aspect (`width / height`) that fully COVERS `visible`,
 * pinned to its left edge and centered vertically. Backs a menu with a
 * fixed-proportion preview that reads as a full background: it fills the
 * visible area at any aspect and overflows (crops) on the right and top/bottom
 * rather than leaving borders. At the design aspect it equals `visible`
 * exactly.
 */
export function coverView(visible: Rect, aspect: number, out?: Rect): Rect {
  const scale = Math.max(visible.width / aspect, visible.height)
  const width = aspect * scale
  const height = scale
  const r = out ?? { x: 0, y: 0, width: 0, height: 0 }
  r.x = visible.x
  r.y = visible.y + (visible.height - height) / 2
  r.width = width
  r.height = height
  return r
}
