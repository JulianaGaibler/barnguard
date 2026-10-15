/**
 * The word that lands over the buffer when something worth naming happens:
 * FLUSH, TWIST, a new level.
 *
 * One normalised clock drives the ring, the word's rise and its fade together,
 * so the three cannot drift apart. No tweens, because a node has to be attached
 * to the scene before `tween` or `wait` will resolve, and an effect that starts
 * from its own constructor would silently never run.
 *
 * The color is fixed for the life of one banner. Animating text color
 * re-rasterises the label every frame it changes, where alpha rides the quad
 * tint for free.
 */
import { easings, Node2D, type Canvas } from '@src/stargazer'
import { font } from '../../fonts'
import { ANIM, FRAME } from '../tuning'
import { ruleWidth, withGlow } from './tui'

export class BannerNode extends Node2D {
  #text = ''
  #sub = ''
  #color = '#FFFFFF'
  #size = 48
  #t = 1

  constructor() {
    super('bo-banner')
  }

  /** Centre the banner on a point, sized against the cell. */
  place(x: number, y: number, cell: number): void {
    this.transform.x = x
    this.transform.y = y
    const size = cell * 1.5
    if (size === this.#size) return
    this.#size = size
    this.markNeedsPaint()
  }

  /** Show `text`, restarting rather than stacking if one is already up. */
  show(text: string, color: string, sub = ''): void {
    this.#text = text
    this.#sub = sub
    this.#color = color
    this.#t = 0
    this.markNeedsPaint()
  }

  /** Cut the banner immediately, for a teardown or a quit. */
  hide(): void {
    if (this.#t >= 1) return
    this.#t = 1
    this.markNeedsPaint()
  }

  /** Every frame of a banner is different, so it paints each one it is up. */
  override onUpdate(dt: number): void {
    if (this.#t >= 1) return
    this.#t = Math.min(1, this.#t + dt / (ANIM.banner + ANIM.bannerHold))
    this.markNeedsPaint()
  }

  override paint(gfx: Canvas): void {
    if (this.#t >= 1 || !this.#text) return
    const span = ANIM.banner / (ANIM.banner + ANIM.bannerHold)
    const ring = Math.min(1, this.#t / span)

    // A rectangle rather than a circle, expanding on the same clock and the
    // same easing. A terminal marks a region by ruling a box around it, and a
    // box is also the only shape the rest of this screen contains.
    if (ring < 1) {
      const eased = easings.outQuint(ring)
      const halfW = this.#size * (1.4 + eased * 5)
      const halfH = this.#size * (0.7 + eased * 2.2)
      gfx.setAlpha((1 - ring) * 0.8)
      gfx.strokeRoundRect(-halfW, -halfH, halfW * 2, halfH * 2, 0, {
        color: this.#color,
        width: this.#size * 0.08 * (1 - ring * 0.7),
        join: 'miter',
      })
      gfx.setAlpha(1)
    }

    // The word outlives the box, drifting up through the hold. Squared so it
    // holds its weight and then leaves quickly rather than lingering half-lit.
    const fade = 1 - this.#t
    const rise = this.#size * 0.6 * this.#t
    const wordFont = font(700, this.#size * (0.9 + this.#t * 0.25))
    const rule = ruleWidth(gfx, FRAME.rulePx)

    // One of the two surfaces allowed a phosphor pass. A word that flashes once
    // and leaves is exactly where bleed reads and nowhere else is.
    withGlow(gfx, rule, ({ glow, spread }) => {
      gfx.setAlpha(glow ? fade * fade * 0.9 : fade * fade)
      gfx.fillText(`>> ${this.#text}`, spread, -rise + spread, {
        font: wordFont,
        align: 'center',
        baseline: 'middle',
        color: this.#color,
      })
      if (this.#sub) {
        gfx.fillText(this.#sub, spread, -rise + this.#size * 0.8 + spread, {
          font: font(400, this.#size * 0.42),
          align: 'center',
          baseline: 'middle',
          color: this.#color,
        })
      }
      gfx.setAlpha(1)
    })
  }
}
