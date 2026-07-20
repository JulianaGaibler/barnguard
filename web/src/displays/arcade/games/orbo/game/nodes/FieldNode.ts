/**
 * Background layer: the two tinted scoring bands, no borders. `leftCenter`
 * (Team R's scoring band) and `rightCenter` (Team L's) each wear the color of
 * the team that scores in them. In 2v2 a team has two players of different
 * colors, so the active player's band re-tints to their color with a short
 * transition (e.g. red-blue → green's turn → red-green). The edge launch strips
 * stay neutral.
 *
 * Drawn on the dynamic layer (behind the orbs, added first) so the color tween
 * is visible — it's just two `fillRect`s per frame.
 */
import {
  SceneNode,
  easings,
  ignoreAbort,
  parseColor,
  type BitmapMask,
  type Gfx2D,
} from '@src/stargazer'
import type { FieldLayout } from '../layout'
import type { TeamId } from '../types'
import { TEAM_COLORS } from '../tuning'

/** Shared, mutable reveal fraction (0 = hidden, 1 = fully open). */
interface RevealRef {
  frac: number
}

// Tint strength over the light (~white) panel — bumped from the old dark-field
// value so the scoring bands still read.
const BAND_ALPHA = 0.3
const RETINT_SEC = 0.35

interface Rgb {
  r: number
  g: number
  b: number
}

// 0..255 channels for the tweenable band colors, parsed through the engine's
// cached `parseColor` (which returns 0..1).
function parseHex(hex: string): Rgb {
  const c = parseColor(hex)
  return { r: c.r * 255, g: c.g * 255, b: c.b * 255 }
}

function rgba(c: Rgb, alpha: number): string {
  return `rgba(${Math.round(c.r)}, ${Math.round(c.g)}, ${Math.round(c.b)}, ${alpha})`
}

export class FieldNode extends SceneNode {
  // leftCenter is Team R's (team 1) band; rightCenter is Team L's (team 0).
  readonly #leftBand = parseHex(TEAM_COLORS[1])
  readonly #rightBand = parseHex(TEAM_COLORS[0])
  readonly #layout: FieldLayout
  readonly #reveal: RevealRef
  readonly #mask: BitmapMask

  constructor(layout: FieldLayout, reveal: RevealRef, mask: BitmapMask) {
    super('field')
    this.#layout = layout
    this.#reveal = reveal
    this.#mask = mask
    this.renderLayer = 'dynamic'
  }

  #bandFor(team: TeamId): Rgb {
    return team === 0 ? this.#rightBand : this.#leftBand
  }

  /** Snap both bands back to the two teams' default colors (no transition). */
  resetColors(): void {
    Object.assign(this.#rightBand, parseHex(TEAM_COLORS[0]))
    Object.assign(this.#leftBand, parseHex(TEAM_COLORS[1]))
  }

  /** Retint a team's scoring band to `hex` with a short transition. */
  setBandColor(team: TeamId, hex: string): void {
    const target = parseHex(hex)
    void this.tweenTo(this.#bandFor(team), target, {
      duration: RETINT_SEC,
      easing: easings.outCubic,
    }).catch(ignoreAbort)
  }

  override draw(gfx: Gfx2D): void {
    const { width, height, leftStripEnd, centerX, rightStripStart } =
      this.#layout
    const frac = this.#reveal.frac
    if (frac <= 0) return

    // During the reveal, bands wipe open with the panel: clamp each to a
    // center-growing window and clip to the rounded mask so nothing spills.
    const revealing = frac < 1
    const win0 = centerX - (width / 2) * frac
    const win1 = centerX + (width / 2) * frac
    const band = (bx0: number, bx1: number, color: string): void => {
      const x0 = revealing ? Math.max(bx0, win0) : bx0
      const x1 = revealing ? Math.min(bx1, win1) : bx1
      if (x1 > x0) gfx.fillRect(x0, 0, x1 - x0, height, color)
    }

    if (revealing) {
      gfx.save()
      gfx.setClipMask(this.#mask)
    }
    band(leftStripEnd, centerX, rgba(this.#leftBand, BAND_ALPHA))
    band(centerX, rightStripStart, rgba(this.#rightBand, BAND_ALPHA))
    if (revealing) {
      gfx.setClipMask(null)
      gfx.restore()
    }
  }
}
