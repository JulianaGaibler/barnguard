import { SceneNode, type BitmapMask, type Gfx2D } from '@src/stargazer'
import { PANEL } from '../tuning'

/**
 * The light, rounded play-field panel. At rest it's a crisp rounded bitmap
 * (rasterized once, cached, blitted). During the match-open it's revealed with
 * a horizontal clip growing from the center: a plain fill clipped to the
 * rounded mask and clamped to a center window, so the rounded corners appear as
 * the curtain reaches them (no squash).
 */
let panelBitmap: OffscreenCanvas | null = null

function ensurePanelBitmap(w: number, h: number): OffscreenCanvas | null {
  if (panelBitmap) return panelBitmap
  if (typeof OffscreenCanvas === 'undefined') return null
  const canvas = new OffscreenCanvas(Math.ceil(w), Math.ceil(h))
  const ctx = canvas.getContext('2d')
  if (!ctx) return null
  ctx.fillStyle = PANEL.bg
  ctx.beginPath()
  ctx.roundRect(0, 0, canvas.width, canvas.height, PANEL.radius)
  ctx.fill()
  panelBitmap = canvas
  return panelBitmap
}

/** Shared, mutable reveal fraction (0 = hidden, 1 = fully open). */
interface RevealRef {
  frac: number
}

export class PanelNode extends SceneNode {
  readonly #px: number
  readonly #py: number
  readonly #pw: number
  readonly #ph: number
  readonly #reveal: RevealRef
  readonly #mask: BitmapMask

  constructor(
    px: number,
    py: number,
    pw: number,
    ph: number,
    reveal: RevealRef,
    mask: BitmapMask,
  ) {
    super('orbo-panel')
    this.#px = px
    this.#py = py
    this.#pw = pw
    this.#ph = ph
    this.#reveal = reveal
    this.#mask = mask
    this.renderLayer = 'dynamic'
  }

  override draw(gfx: Gfx2D): void {
    const frac = this.#reveal.frac
    if (frac <= 0) return
    if (frac >= 1) {
      const bmp = ensurePanelBitmap(this.#pw, this.#ph)
      if (bmp) gfx.drawImage(bmp, this.#px, this.#py, this.#pw, this.#ph)
      return
    }
    // Revealing: fill clipped to the rounded mask, clamped to a center window
    // that grows outward — a horizontal curtain with rounded corners.
    const cx = this.#px + this.#pw / 2
    const halfW = (this.#pw / 2) * frac
    gfx.save()
    gfx.setClipMask(this.#mask)
    gfx.fillRect(cx - halfW, this.#py, halfW * 2, this.#ph, PANEL.bg)
    gfx.setClipMask(null)
    gfx.restore()
  }
}
