// Which floor is in play, as a car in a shaft beside the two shortlists.
//
// The floor marker is the rule that decides where a hire can come from, and it
// moves for three different reasons: an approval spent on it, a card that sends
// it across, and undoing either. A car that travels says all three happened
// without the board having to announce which.

import {
  Node2D,
  easings,
  ignoreAbort,
  type Gfx2D,
  type Rect,
} from '@src/stargazer'
import { ANIM, COLORS } from '../tuning'
import { drawIcon, iconWidth, icons } from '../../art/icons'
import type { Floor } from '../rules/deck'

export class ElevatorNode extends Node2D {
  #rect: Rect = { x: 0, y: 0, width: 0, height: 0 }
  /** Where the car rests on each floor, in world y. */
  #stops: [number, number] = [0, 0]
  /** How far down the shaft the car is. Tweened, so it is its own object. */
  readonly #car = { t: 0 }

  constructor(id: string) {
    super(id)
    this.renderLayer = 'dynamic'
  }

  /** The shaft, and the y each floor's car centre sits at. */
  setGeom(rect: Rect, management: number, ic: number): void {
    this.#rect = rect
    this.#stops = [management, ic]
  }

  /** Send the car to `floor`, or put it there if it has never moved. */
  goTo(floor: Floor, animate: boolean): void {
    const t = floor === 'ic' ? 1 : 0
    if (!animate) {
      this.#car.t = t
      return
    }
    void this.tweenTo(
      this.#car,
      { t },
      { duration: ANIM.elevator, easing: easings.inOutCubic, key: 'fs-lift' },
    ).catch(ignoreAbort)
  }

  override draw(gfx: Gfx2D): void {
    const r = this.#rect
    if (r.width <= 0 || r.height <= 0) return
    const set = icons()
    if (!set) return

    const railW = Math.max(1, r.width * 0.06)
    const cx = r.x + r.width / 2
    gfx.fillRoundRect(
      cx - railW / 2,
      r.y,
      railW,
      r.height,
      railW / 2,
      COLORS.panelBorder,
    )

    const [top, bottom] = this.#stops
    const y = top + (bottom - top) * this.#car.t
    const car = set.elevator
    const size = r.width
    drawIcon(gfx, car, cx - iconWidth(car, size) / 2, y - size / 2, size)
  }
}
