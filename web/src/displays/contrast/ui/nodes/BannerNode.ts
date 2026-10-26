/**
 * The banner: the team, the logo and the game's name. Two of them share the top
 * of the screen. One sits under the cards in the screen's text color. The other
 * sits over them in the text color of the card under it, clipped to that card,
 * so a card zooming over the banner changes its color exactly where it passes.
 */
import { definePaintProps, Node2D, type Canvas } from 'stargazer'
import { LOGO_HEIGHT, type Layout } from '../layout'
import { fillTracked, textFont } from '../text'
import { logoGlyph, drawGlyph } from '../icons'

const SIZE = 16
const TRACKING = 3.68
const CAP = 0.7

/** A rounded rectangle the banner is clipped to, in the banner's own space. */
export interface BannerClip {
  x: number
  y: number
  width: number
  height: number
  radius: number
}

export class BannerNode extends Node2D {
  declare layout: Layout
  declare color: string
  declare clip2: BannerClip | null

  readonly #left: string
  readonly #right: string

  constructor(layout: Layout, left: string, right: string, color: string) {
    super('banner')
    definePaintProps(this, { layout, color, clip2: null })
    this.#left = left
    this.#right = right
    this.setLayout(layout)
  }

  setLayout(layout: Layout): void {
    this.layout = layout
    this.boundsOverride = {
      x: 0,
      y: 0,
      width: layout.width,
      height: layout.banner.logo.y + LOGO_HEIGHT + 8,
    }
  }

  override paint(canvas: Canvas): void {
    const { banner } = this.layout
    const clip = this.clip2
    if (clip) {
      canvas.save()
      canvas.setClip({
        kind: 'roundRect',
        x: clip.x,
        y: clip.y,
        w: clip.width,
        h: clip.height,
        radius: clip.radius,
      })
    }
    const style = {
      font: textFont(SIZE),
      color: this.color,
      tracking: TRACKING,
    }
    const baseline = banner.centerY + (SIZE * CAP) / 2
    fillTracked(canvas, this.#left, banner.left, baseline, style, 'left')
    fillTracked(canvas, this.#right, banner.right, baseline, style, 'right')
    drawGlyph(
      canvas,
      logoGlyph(),
      banner.logo.x,
      banner.logo.y,
      banner.logo.width,
      this.color,
    )
    if (clip) canvas.restore()
  }
}
