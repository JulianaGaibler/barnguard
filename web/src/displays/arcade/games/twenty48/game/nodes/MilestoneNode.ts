/**
 * The moment a board reaches a value it has never held before: a ring expanding
 * out of the cell, with the new number ghosting up behind it.
 *
 * Both parts are driven from one normalized clock rather than from tweens, so
 * the ring's radius and the numeral's fade cannot drift apart. The ring is this
 * node's own picture, which repaints while it grows. The numeral is a child
 * whose transform the clock writes, so its picture is painted once per fire.
 */
import { definePaintProps, easings, Node2D, type Canvas } from 'stargazer'
import { headingFont } from '../../fonts'
import { ANIM, tileColor } from '../tuning'

/** The numeral that drifts up and fades, moved by its transform alone. */
class NumeralNode extends Node2D {
  declare value: number
  declare cell: number

  constructor() {
    super('t48-milestone-numeral')
    definePaintProps(this, { value: 0, cell: 0 })
    this.transform.alpha = 0
  }

  override paint(gfx: Canvas): void {
    if (this.value === 0) return
    gfx.fillText(String(this.value), 0, 0, {
      font: headingFont(700, this.cell * 0.85),
      align: 'center',
      baseline: 'middle',
      color: tileColor(this.value),
    })
  }
}

export class MilestoneNode extends Node2D {
  /** Progress of the whole moment, 1 when it is over. */
  #t = 1
  readonly #numeral = new NumeralNode()
  /** Progress of the ring alone, 1 once it has faded out. */
  declare ring: number
  declare value: number
  declare cell: number

  constructor() {
    super('t48-milestone')
    definePaintProps(this, { ring: 1, value: 0, cell: 0 })
    this.add(this.#numeral)
  }

  /** Play the moment at a cell center. Re-firing restarts it. */
  fire(x: number, y: number, value: number, cell: number): void {
    this.transform.x = x
    this.transform.y = y
    this.value = value
    this.cell = cell
    this.#numeral.value = value
    this.#numeral.cell = cell
    this.#t = 0
    this.#advance()
  }

  override onUpdate(dt: number): void {
    if (this.#t >= 1) return
    this.#t = Math.min(1, this.#t + dt / (ANIM.milestone + ANIM.milestoneHold))
    this.#advance()
  }

  /** Write the clock into the ring's prop and the numeral's transform. */
  #advance(): void {
    const t = this.#t
    const span = ANIM.milestone / (ANIM.milestone + ANIM.milestoneHold)
    this.ring = Math.min(1, t / span)

    const numeral = this.#numeral.transform
    if (t >= 1) {
      numeral.alpha = 0
      return
    }
    const fade = 1 - t
    // The numeral grows by scale from its largest size, so its picture never
    // changes with the clock.
    const grow = (0.5 + t * 0.35) / 0.85
    numeral.alpha = fade * fade
    numeral.y = -this.cell * 0.5 * t
    numeral.scaleX = grow
    numeral.scaleY = grow
  }

  override paint(gfx: Canvas): void {
    const ring = this.ring
    if (ring >= 1 || this.value === 0) return
    const eased = easings.outQuint(ring)
    gfx.setAlpha(1 - ring)
    gfx.strokeCircle(0, 0, this.cell * (0.4 + eased * 1.8), {
      color: tileColor(this.value),
      width: this.cell * 0.07 * (1 - ring * 0.6),
    })
  }
}
