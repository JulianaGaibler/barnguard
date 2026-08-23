/**
 * The moment a board reaches a value it has never held before: a ring expanding
 * out of the cell, with the new number ghosting up behind it.
 *
 * Both parts are driven from one normalized clock rather than from tweens, so
 * the ring's radius and the numeral's fade cannot drift apart.
 */
import { easings, Node2D, type Gfx2D } from '@src/stargazer'
import { headingFont } from '../../fonts'
import { ANIM, tileColor } from '../tuning'

export class MilestoneNode extends Node2D {
  #t = 1
  #value = 0
  #cell = 0

  constructor() {
    super('t48-milestone')
    this.renderLayer = 'dynamic'
  }

  /** Play the moment at a cell center. Re-firing restarts it. */
  fire(x: number, y: number, value: number, cell: number): void {
    this.transform.x = x
    this.transform.y = y
    this.#value = value
    this.#cell = cell
    this.#t = 0
    const reach = cell * 2.4
    this.debugBounds = {
      x: -reach,
      y: -reach,
      width: reach * 2,
      height: reach * 2,
    }
  }

  override onUpdate(dt: number): void {
    if (this.#t >= 1) return
    this.#t = Math.min(1, this.#t + dt / (ANIM.milestone + ANIM.milestoneHold))
  }

  override draw(gfx: Gfx2D): void {
    if (this.#t >= 1 || this.#value === 0) return
    const color = tileColor(this.#value)
    const span = ANIM.milestone / (ANIM.milestone + ANIM.milestoneHold)
    const ring = Math.min(1, this.#t / span)
    const eased = easings.outQuint(ring)

    if (ring < 1) {
      gfx.setAlpha(1 - ring)
      gfx.strokeCircle(0, 0, this.#cell * (0.4 + eased * 1.8), {
        color,
        width: this.#cell * 0.07 * (1 - ring * 0.6),
      })
      gfx.setAlpha(1)
    }

    // The numeral outlives the ring, drifting up through the hold.
    const fade = 1 - this.#t
    gfx.setAlpha(fade * fade)
    gfx.fillText(String(this.#value), 0, -this.#cell * 0.5 * this.#t, {
      font: headingFont(700, this.#cell * (0.5 + this.#t * 0.35)),
      align: 'center',
      baseline: 'middle',
      color,
    })
    gfx.setAlpha(1)
  }
}
