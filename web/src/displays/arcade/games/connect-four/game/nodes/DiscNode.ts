import { SceneNode, type Gfx2D } from '@src/stargazer'

/**
 * One placed disc. It lives on a layer behind the board, so the board's holes
 * frame it. `radius` is fixed; the drop and the board close animate the node's
 * transform (`y` for the fall, `scaleX`/`scaleY` for the shrink-away on
 * close).
 */
export class DiscNode extends SceneNode {
  readonly #radius: number
  readonly #color: string

  constructor(color: string, radius: number) {
    super('cf-disc')
    this.#color = color
    this.#radius = radius
    this.renderLayer = 'dynamic'
  }

  override draw(gfx: Gfx2D): void {
    gfx.fillCircle(0, 0, this.#radius, this.#color)
  }
}
