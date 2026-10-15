/**
 * A single bouncing ball. The physics `body` is the source of truth for
 * position. `onUpdate` mirrors it into the transform each frame, interpolating
 * between the body's last two fixed-step positions by the ticker's `fixedAlpha`
 * so motion stays smooth regardless of display rate vs the 120 Hz simulation.
 */
import { Node2D, lerp, type Body, type Canvas } from '@src/stargazer'

export class BallNode extends Node2D {
  readonly body: Body
  readonly #radius: number
  readonly #color: string

  constructor(body: Body, radius: number, color: string) {
    super(`ball-${body.id}`)
    this.body = body
    this.#radius = radius
    this.#color = color
    this.transform.x = body.position.x
    this.transform.y = body.position.y
  }

  override onUpdate(): void {
    const alpha = this.scene?.engine?.ticker.fixedAlpha ?? 1
    const prev = this.body.prevPosition
    this.transform.x = lerp(prev.x, this.body.position.x, alpha)
    this.transform.y = lerp(prev.y, this.body.position.y, alpha)
  }

  override paint(gfx: Canvas): void {
    gfx.fillCircle(0, 0, this.#radius, this.#color)
  }
}
