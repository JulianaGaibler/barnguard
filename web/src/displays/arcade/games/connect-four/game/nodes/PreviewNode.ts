import { Node2D, definePaintProps, type Canvas } from 'stargazer'

/**
 * A translucent disc hovering above a column while the player is choosing where
 * to drop. Renders in front of the board (above its top edge). The session sets
 * its color, x (column), and visibility.
 */
export class PreviewNode extends Node2D {
  readonly #radius: number
  declare color: string

  constructor(radius: number) {
    super('cf-preview')
    definePaintProps(this, { color: '#ffffff' })
    this.#radius = radius
    this.visible = false
  }

  setColor(color: string): void {
    this.color = color
  }

  override paint(gfx: Canvas): void {
    gfx.setAlpha(0.5)
    gfx.fillCircle(0, 0, this.#radius, this.color)
  }
}
