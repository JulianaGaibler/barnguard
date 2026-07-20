import { SceneNode, type Gfx2D } from '@src/stargazer'

/**
 * A translucent disc hovering above a column while the player is choosing where
 * to drop. Renders in front of the board (above its top edge). The session sets
 * its color, x (column), and visibility.
 */
export class PreviewNode extends SceneNode {
  readonly #radius: number
  #color = '#ffffff'

  constructor(radius: number) {
    super('cf-preview')
    this.#radius = radius
    this.renderLayer = 'dynamic'
    this.visible = false
  }

  setColor(color: string): void {
    this.#color = color
  }

  override draw(gfx: Gfx2D): void {
    gfx.setAlpha(0.5)
    gfx.fillCircle(0, 0, this.#radius, this.#color)
  }
}
