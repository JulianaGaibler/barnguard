import { Node2D, easings, type CameraView2D, type Gfx2D } from '@src/stargazer'
import { ANIM, WIN } from '../tuning'

interface Point {
  x: number
  y: number
}

/**
 * The winning line: a thin white segment connecting the four winning chips,
 * drawn on over {@link ANIM.winLineDraw} seconds, with a ring + dot "node" mark
 * popping in on each chip as the line reaches it. The winning cells are
 * collinear, so the tip lerps along the first→last segment. Coordinates are
 * world-space; add this at identity transform so local == world. Self-drives
 * its progress, so no external tween is needed.
 */
const RING_POP_DURATION = 0.12

export class WinLineNode extends Node2D {
  readonly #centers: readonly Point[]
  readonly #ringRadius: number
  readonly #dotRadius: number
  #progress = 0

  constructor(centers: readonly Point[], cell: number) {
    super('cf-win-line')
    this.renderLayer = 'dynamic'
    this.#centers = centers
    this.#ringRadius = cell * WIN.ringRadiusFrac
    this.#dotRadius = cell * WIN.dotRadiusFrac
  }

  override onUpdate(dt: number): void {
    // Progress keeps advancing past 1 so the last chip's ring gets its full
    // pop-in window too; only the line's tip position clamps to 1 in draw().
    const max = 1 + RING_POP_DURATION
    if (this.#progress >= max || dt <= 0) return
    this.#progress = Math.min(max, this.#progress + dt / ANIM.winLineDraw)
  }

  override draw(gfx: Gfx2D, camera: CameraView2D): void {
    const pts = this.#centers
    const n = pts.length
    if (n < 2) return
    const strokeScale = camera.strokeSpaceScale()
    const p0 = pts[0]
    const pLast = pts[n - 1]
    const t = this.#progress
    const lineT = Math.min(1, t)
    const tipX = p0.x + (pLast.x - p0.x) * lineT
    const tipY = p0.y + (pLast.y - p0.y) * lineT
    gfx.strokeLine(p0.x, p0.y, tipX, tipY, {
      color: WIN.lineColor,
      width: WIN.lineWidth * strokeScale,
      cap: 'round',
    })

    // Node marks pop in as the tip passes each chip.
    const ringStyle = {
      color: WIN.ringColor,
      width: WIN.ringWidth * strokeScale,
    }
    for (let i = 0; i < n; i++) {
      const ti = n === 1 ? 0 : i / (n - 1)
      if (t < ti) continue
      const pop = easings.outBack(Math.min(1, (t - ti) / RING_POP_DURATION))
      const point = pts[i]
      gfx.strokeCircle(point.x, point.y, this.#ringRadius * pop, ringStyle)
      gfx.fillCircle(point.x, point.y, this.#dotRadius * pop, WIN.lineColor)
    }
  }
}
