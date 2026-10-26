/** The score and the clock: two circles at the right of the bottom row. */
import { definePaintProps, GfxPath, Node2D, type Canvas } from 'stargazer'
import { OUTLINE_COLOR } from '../../game/outline'
import { PALETTE } from '../../theme'
import { HUD_DIAMETER, type Layout } from '../layout'
import { textFont } from '../text'

const RADIUS = HUD_DIAMETER / 2
const EDGE = { color: OUTLINE_COLOR, width: { screen: 1 } }
const RING_RADIUS = 33
const RING_WIDTH = 6
const RING_COLOR = PALETTE.white
const RING = { color: RING_COLOR, width: RING_WIDTH }
/** Points on a full circle of the ring, so an arc stays round at this size. */
const RING_STEPS = 72

export class HudNode extends Node2D {
  declare layout: Layout
  declare score: number
  declare seconds: number
  /** How much of the ring is left, 0 to 1. */
  declare ring: number
  readonly #path = new GfxPath()

  constructor(layout: Layout) {
    super('hud')
    definePaintProps(this, { layout, score: 0, seconds: 0, ring: 1 })
    this.setLayout(layout)
  }

  setLayout(layout: Layout): void {
    this.layout = layout
    const { score, time } = layout.hud
    this.boundsOverride = {
      x: score.x - RADIUS,
      y: score.y - RADIUS,
      width: time.x - score.x + HUD_DIAMETER,
      height: HUD_DIAMETER,
    }
  }

  override destroy(): void {
    this.#path.release()
    super.destroy()
  }

  override paint(canvas: Canvas): void {
    const { score, time } = this.layout.hud
    for (const at of [score, time]) {
      canvas.fillAndStrokeCircle(at.x, at.y, RADIUS, PALETTE.ink, EDGE)
    }
    canvas.fillText(String(this.score), score.x, score.y, {
      font: textFont(this.score > 99 ? 28 : 40),
      color: PALETTE.white,
      align: 'center',
      baseline: 'middle',
    })
    canvas.fillText(String(this.seconds), time.x, time.y, {
      font: textFont(24),
      color: PALETTE.white,
      align: 'center',
      baseline: 'middle',
    })
    this.#drawRing(canvas, time.x, time.y)
  }

  #drawRing(canvas: Canvas, cx: number, cy: number): void {
    const left = Math.min(Math.max(this.ring, 0), 1)
    if (left <= 0) return
    if (left >= 0.999) {
      canvas.strokeCircle(cx, cy, RING_RADIUS, RING)
      return
    }
    const path = this.#path.clear()
    const steps = Math.max(2, Math.ceil(RING_STEPS * left))
    for (let i = 0; i <= steps; i++) {
      const angle = -Math.PI / 2 + (i / steps) * left * Math.PI * 2
      const x = cx + Math.cos(angle) * RING_RADIUS
      const y = cy + Math.sin(angle) * RING_RADIUS
      if (i === 0) path.moveTo(x, y)
      else path.lineTo(x, y)
    }
    canvas.strokePath(path, RING)
  }
}
