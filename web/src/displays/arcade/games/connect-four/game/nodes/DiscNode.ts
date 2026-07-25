import { SceneNode, easings, type Gfx2D } from '@src/stargazer'
import { ANIM } from '../tuning'

/**
 * One placed disc. It lives on a layer in front of the board, so it sits over
 * its slot well (a ring of well shows around it) and covers the slot's faint X.
 * `radius` is fixed; the drop and the board close animate the node's transform
 * (`y` for the fall, `scaleX`/`scaleY` for the shrink-away on close). The fill
 * color can change (a winning disc recolors to its glow shade).
 */
export class DiscNode extends SceneNode {
  readonly #radius: number
  #color: string

  constructor(color: string, radius: number) {
    super('cf-disc')
    this.#color = color
    this.#radius = radius
    this.renderLayer = 'dynamic'
  }

  /** Recolor the disc (used to glow the winning line). */
  setColor(color: string): void {
    this.#color = color
  }

  override draw(gfx: Gfx2D): void {
    gfx.fillCircle(0, 0, this.#radius, this.#color)
  }

  /**
   * Fall to `y` and settle: `rowsFallen` scales the fall so a longer drop takes
   * longer, and the landing bounces off `y` as a hard floor rather than
   * overshooting past it. `onStep` runs each tick during the fall (used to
   * trail a particle emitter behind the disc from its live position). Rejects
   * with `AbortError` if `signal` fires mid-fall, so the caller's sequence
   * unwinds.
   */
  drop(
    y: number,
    rowsFallen: number,
    onStep?: () => void,
    signal?: AbortSignal,
  ): Promise<void> {
    const duration = ANIM.dropBase + rowsFallen * ANIM.dropPerRow
    return this.tween(
      { y },
      { duration, easing: easings.outBounce, onUpdate: onStep, signal },
    )
  }
}
