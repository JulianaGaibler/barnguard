import { SceneNode, type Gfx2D } from '@src/stargazer'

/**
 * A small horizontal capsule above the board that marks the active drop column.
 * The session moves it over the hovered column and tints it the current
 * player's color; it's hidden when no column is being chosen. Drawn centered on
 * the node's origin.
 */
export class DropIndicatorNode extends SceneNode {
  readonly #width: number
  readonly #height: number
  #color = '#ffffff'

  constructor(width: number, height: number) {
    super('cf-drop-indicator')
    this.#width = width
    this.#height = height
    this.renderLayer = 'dynamic'
    this.visible = false
  }

  setColor(color: string): void {
    this.#color = color
  }

  override draw(gfx: Gfx2D): void {
    const w = this.#width
    const h = this.#height
    // Capsule: a rounded rect whose radius is half the height (clamped there).
    gfx.fillRoundRect(-w / 2, -h / 2, w, h, h / 2, this.#color)
  }
}
