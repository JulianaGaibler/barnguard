/**
 * The fade at the bottom of a card that fills the screen, so the text runs out
 * into the card's color instead of being cut. It is clipped to the card's own
 * rounded shape, since a card on its way to full screen still has corners.
 */
import { definePaintProps, Node2D, withAlpha, type Canvas } from 'stargazer'

/** How tall the fade is, in design pixels. */
export const FADE_HEIGHT = 310

export class FadeNode extends Node2D {
  declare width: number
  declare height: number
  declare radius: number
  declare fill: string

  constructor(fill: string) {
    super('card-fade')
    definePaintProps(this, { width: 0, height: 0, radius: 0, fill })
  }

  setShape(width: number, height: number, radius: number): void {
    this.width = width
    this.height = height
    this.radius = radius
    this.boundsOverride = {
      x: 0,
      y: height - FADE_HEIGHT,
      width,
      height: FADE_HEIGHT,
    }
  }

  override paint(canvas: Canvas): void {
    const { width: w, height: h, radius } = this
    if (w <= 0 || h <= 0) return
    const top = h - FADE_HEIGHT
    canvas.save()
    canvas.setClip({ kind: 'roundRect', x: 0, y: 0, w, h, radius })
    canvas.fillRect(0, top, w, FADE_HEIGHT, {
      kind: 'linear',
      x0: 0,
      y0: top,
      x1: 0,
      y1: h,
      stops: [
        { offset: 0, color: withAlpha(this.fill, 0) },
        { offset: 1, color: this.fill },
      ],
    })
    canvas.restore()
  }
}
