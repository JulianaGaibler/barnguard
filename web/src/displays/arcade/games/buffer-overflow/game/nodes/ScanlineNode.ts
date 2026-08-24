/**
 * A very faint scanline field over the whole game region.
 *
 * The cheapest half of a CRT, and the half that does not need a shader. Around
 * a hundred and eighty bars on the shared shape program, which is well inside
 * the instance ring and costs one batch.
 *
 * Two things have to be right or it looks worse than nothing.
 *
 * It works in whole device pixels. A CSS pixel is not a hardware pixel: at a
 * device pixel ratio of one and a half a one-CSS-pixel bar covers one and a
 * half hardware rows, so consecutive bars alternate between covering one row
 * and two and the field beats against itself in a moiré. Both the thickness and
 * the period go through `ruleWidth`, the same snap every rule in the game uses,
 * so each bar is an identical whole number of hardware rows.
 *
 * The positions need no snapping of their own. The period is a whole number of
 * device pixels and the field is phased from the top of the visible rect, which
 * is hardware row zero, so every bar lands on a row by construction.
 *
 * It is phased from the camera's visible rect but clamped to the game region.
 * Scanlines belong to the screen, so a field pinned to the world would crawl
 * across itself during the launcher pan. But the region below is the launcher,
 * which is not this game's to draw on. Phase from one, clamp to the other, and
 * the bars hold still on screen while filling only the game's own half.
 *
 * Clamped rather than clipped. A clip is a state change and would break the
 * batch that holds the rest of the screen together, and two comparisons do the
 * same job.
 */
import { Node2D, type CameraView2D, type Gfx2D } from '@src/stargazer'
import { COLORS } from '../tuning'
import type { Bounds } from '../types'
import { ruleWidth } from './tui'

const ZERO: Bounds = { x: 0, y: 0, width: 0, height: 0 }

/**
 * Bar thickness and spacing, in CSS pixels, before rounding to device pixels.
 *
 * Two rather than one, at three times the spacing to hold the same one-in-three
 * coverage. A single-pixel bar is the thinnest feature a display can hold, so
 * it has nothing left to give: any resampling on the way to the panel, whether
 * a fractional ratio, browser zoom or a scaled-out cabinet, lands it between
 * rows and the field shimmers. A two-pixel bar survives all of that, and at
 * arm's length across a cabinet it reads the same.
 */
const THICK_CSS_PX = 2
const PERIOD_CSS_PX = 6

export class ScanlineNode extends Node2D {
  #region: Bounds = ZERO

  constructor() {
    super('bo-scanlines')
    // Added last, so it lies over everything the canvas draws.
    this.renderLayer = 'dynamic'
  }

  /** The game's own region. Nothing is drawn outside it. */
  setRegion(region: Bounds): void {
    this.#region = region
  }

  override draw(gfx: Gfx2D, camera: CameraView2D): void {
    const view = camera.visibleWorldRect()
    if (view.height <= 0) return
    const scale = camera.strokeSpaceScale()

    // Whole device pixels, so every bar is the same and the period never
    // drifts. Apparent size stays a constant one row in three at any ratio.
    const thick = ruleWidth(gfx, THICK_CSS_PX, scale)
    // Twice the thickness is the floor rather than a comfortable gap, because
    // it is the point at which the bars would merge into a solid fill. It only
    // binds if a ratio ever snaps the period down onto the thickness.
    const period = Math.max(thick * 2, ruleWidth(gfx, PERIOD_CSS_PX, scale))

    const r = this.#region
    const left = Math.max(view.x, r.x)
    const right = Math.min(view.x + view.width, r.x + r.width)
    const top = Math.max(view.y, r.y)
    const bottom = Math.min(view.y + view.height, r.y + r.height)
    if (right <= left || bottom <= top) return

    // Phase from the visible rect's own top, which is what keeps the field
    // still on screen while the camera moves under it, then start at the first
    // bar that falls inside the region.
    const first = Math.ceil((top - view.y) / period)
    const rows = Math.floor((bottom - view.y) / period)
    for (let i = first; i <= rows; i++) {
      gfx.fillRoundRect(
        left,
        view.y + i * period,
        right - left,
        thick,
        0,
        COLORS.scan,
      )
    }
  }
}
