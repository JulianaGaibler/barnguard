import type { Rect } from '@src/stargazer'
import { BOOTH_CORNER_SIZE_PX } from '@src/core/attendant/boothMenuToggle'

/**
 * The arcade's world: two stacked 16:9 regions the camera pans between. The
 * GAME region (top) holds the games. The LAUNCHER region (bottom) holds the
 * launcher chrome. The shared sky gradient spans the whole world.
 *
 * The camera fits a region's 1920×1080 viewport into the canvas
 * aspect-preserving (letterbox). On a narrower-than-16:9 canvas that fit
 * reveals extra world above and below the framed region. If the regions merely
 * touched, that over-draw would bleed one region's content into the other's
 * view. So the vertical GAP between the two regions is made large enough to
 * swallow that over-draw at the current aspect. It is recomputed on resize (see
 * `updateLayout`). The gap is pure sky, so the bleed only ever shows sky, never
 * the neighbor's content.
 *
 * The gap also carries a budget for menu backdrops that draw past their own
 * cover rect deliberately, which is what {@link PREVIEW_BLEED_BUDGET_FRAC}
 * bounds. A backdrop needing more than that has to crop itself instead.
 */
export const REGION_WIDTH = 1920
export const REGION_HEIGHT = 1080

/**
 * Extra sky buffer beyond the strict region separation, as a fraction of a
 * region's cover height.
 *
 * A menu backdrop may draw past its own cover rect deliberately: a field sized
 * so its boundary falls off screen rather than across it, or elements staged
 * just outside the frame before they drift in. That over-draw has to land in
 * this band, which is pure sky, instead of in the neighbouring region's view.
 *
 * A fraction rather than a fixed distance because the over-draw is itself
 * expressed against the region, so it grows with the region on a wide canvas
 * while a constant would not. {@link PREVIEW_BLEED_BUDGET_FRAC} is the share of
 * that a backdrop may use.
 */
const GAP_MARGIN_FRAC = 0.24
/** Floor for the buffer, so a small canvas still gets a visible band of sky. */
const GAP_MARGIN_MIN = 60

/**
 * How far past its own cover rect a menu backdrop may draw, as a fraction of
 * the cover height.
 *
 * Anything within this is swallowed by the sky band between the regions.
 * Anything beyond it is visible from the neighbouring region, which reads as
 * content hanging into the launcher and popping in and out as the cull rect
 * catches it. A backdrop that needs more than this has to crop instead.
 */
export const PREVIEW_BLEED_BUDGET_FRAC = 0.2

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
 * region's content can fill a cover rect at the region aspect (the menu preview
 * does), which overflows the visible rect vertically on wide aspects, so the
 * separation tracks that cover extent rather than a near-16:9 constant. On top
 * of that comes the sky margin, itself a fraction of the cover height, since
 * the backdrop over-draw it has to hide is expressed against the region and so
 * grows with it.
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
  const gap =
    Math.max(0, (visH + coverH) / 2 - REGION_HEIGHT) +
    Math.max(GAP_MARGIN_MIN, coverH * GAP_MARGIN_FRAC)
  layout.launcherTop = REGION_HEIGHT + gap
  layout.worldHeight = layout.launcherTop + REGION_HEIGHT
}

/** Camera framing for the game (top region), fixed, independent of the gap. */
export function gameView(): Rect {
  return { x: 0, y: 0, width: REGION_WIDTH, height: REGION_HEIGHT }
}

/** Camera framing for the launcher (bottom region), moves with the gap. */
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
 * World units per canvas CSS pixel while the camera frames a region.
 *
 * A region is letterboxed into the canvas, so the scale is the same on both
 * axes. This is what converts a size that must stay fixed on screen (a tap
 * target, a gesture box) into the world units game layout is written in. Node
 * `draw` methods already get this from `camera.strokeSpaceScale()`; this is the
 * same number for layout code, which has no camera.
 */
export function worldPerCssPx(cssW: number, cssH: number): number {
  const scale = Math.min(cssW / REGION_WIDTH, cssH / REGION_HEIGHT)
  return scale > 0 ? 1 / scale : 1
}

/**
 * How far the booth's corner gesture reaches into the game region, in world
 * units, for a canvas of the given CSS size.
 *
 * The attendant opens the booth menu by double-tapping either top corner. That
 * listener is on `window` at capture phase and swallows the event, so a game
 * control overlapping a corner box never sees the tap at all, however it is
 * painted or hit-tested. Game chrome in a top corner has to clear this.
 *
 * The reach is the same on both axes, so clearing it on EITHER one is enough:
 * move the control down past this depth, or in from the side edge by this much.
 * Which one to give up depends on what else the game keeps at the top. Below
 * the boxes the full width is free, since the corner test only applies near the
 * top edge.
 *
 * Recompute on resize. The gesture box is a fixed CSS size, so the world extent
 * it covers grows as the canvas gets smaller.
 */
export function boothCornerInset(cssW: number, cssH: number): number {
  // One CSS pixel past the box, because the gesture's own bounds test is
  // inclusive on both axes: a control resting exactly on the edge is still
  // inside the corner and still loses its taps.
  return (BOOTH_CORNER_SIZE_PX + 1) * worldPerCssPx(cssW, cssH)
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
