/**
 * The "+N" that rises off a merge and fades out, then removes itself.
 *
 * Driven from `onUpdate` rather than from a tween, deliberately. `Node.tween`
 * and `Node.wait` reject unless the node is already attached to a scene, so an
 * effect node that animates from its own constructor silently never runs and,
 * worse, never reaches the `destroy()` on the far side of the wait: it just
 * hangs on screen. Counting elapsed time here cannot care what order the caller
 * constructs and adds in. Same shape as `MergeBurstNode`.
 *
 * Only alpha and position move. The color is fixed, because animating text
 * color re-rasterizes the label every frame it changes.
 */
import { easings, Node2D, type Gfx2D } from '@src/stargazer'
import { headingFont } from '../../fonts'
import { ANIM, COLORS } from '../tuning'

export class FloatingScoreNode extends Node2D {
  readonly #text: string
  readonly #size: number
  readonly #baseY: number
  #life = 0

  constructor(gained: number, x: number, y: number, size: number) {
    super('t48-float-score')
    this.renderLayer = 'dynamic'
    this.#text = `+${gained}`
    this.#size = size
    this.#baseY = y
    this.transform.x = x
    this.transform.y = y
    this.debugBounds = {
      x: -size * 2,
      y: -size - ANIM.floatRise,
      width: size * 4,
      height: size * 2 + ANIM.floatRise,
    }
  }

  override onUpdate(dt: number): void {
    this.#life += dt
    const t = Math.min(1, this.#life / ANIM.floatScore)
    this.transform.y = this.#baseY - ANIM.floatRise * easings.outQuad(t)
    this.transform.alpha = 1 - t
    if (t >= 1 && !this.isDestroyed) this.destroy()
  }

  override draw(gfx: Gfx2D): void {
    if (this.transform.alpha <= 0) return
    gfx.fillText(this.#text, 0, 0, {
      font: headingFont(700, this.#size),
      align: 'center',
      baseline: 'middle',
      color: COLORS.ink,
    })
  }
}
