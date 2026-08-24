/**
 * A load history graph, in the manner every modern terminal monitor draws one.
 *
 * The one thing in the ambient columns that is meant to be looked at, which is
 * why it is a graph and not another table. A column of numbers is information
 * nobody reads. A shape is legible at a glance and is the reason a dashboard
 * looks like a dashboard.
 *
 * It still has to stay out of the way, so it moves in steps. A bar arrives at
 * the right about every second and a half and nothing changes in between. A
 * graph that slid continuously would put motion on every frame, right beside a
 * board the player is trying to read.
 *
 * Column headers are inverse video, which is the oldest table idiom a terminal
 * has and the cheapest way to make three numbers read as a readout rather than
 * as a caption.
 */
import {
  Node2D,
  textAdvance,
  type CameraView2D,
  type Gfx2D,
} from '@src/stargazer'
import { seededRandom, type Random } from '../../../common/rng'
import { font } from '../../fonts'
import { MAX_LEVEL } from '../gravity'
import { textFloor } from '../layout'
import {
  createHistory,
  historyMean,
  historyPeak,
  loadFor,
  stepHistory,
  type History,
} from '../telemetry'
import { accentForLevel, COLORS, FRAME } from '../tuning'
import type { Bounds } from '../types'
import { capBaseline, drawFrame, drawInverse, drawRun, ruleWidth } from './tui'

const ZERO: Bounds = { x: 0, y: 0, width: 0, height: 0 }

/** Bars in the window. About a minute of history at the sample rate. */
const SAMPLES = 40
/** How far back the whole column sits. */
const DIM = 0.5

export interface GraphPaneOptions {
  title: string
  /** The three column headers, left to right. */
  columns: readonly [string, string, string]
  seed: number
}

export class GraphPaneNode extends Node2D {
  readonly #title: string
  readonly #columns: readonly [string, string, string]
  readonly #history: History
  readonly #random: Random

  #rect: Bounds = ZERO
  #cell = 1
  #accent = accentForLevel(1)
  #load = 0

  constructor(opts: GraphPaneOptions) {
    super(`bo-graph-${opts.title}`)
    this.renderLayer = 'dynamic'
    this.#title = opts.title
    this.#columns = opts.columns
    this.#history = createHistory(SAMPLES, opts.seed)
    this.#random = seededRandom(opts.seed ^ 0x9e37)
    this.transform.alpha = DIM
  }

  setRect(rect: Bounds, cell: number): void {
    this.#rect = rect
    this.#cell = cell
    this.debugBounds = { ...rect }
  }

  setLevel(level: number): void {
    this.#accent = accentForLevel(level)
    this.#load = loadFor(level, MAX_LEVEL)
  }

  override onUpdate(dt: number): void {
    if (this.#rect.width <= 0) return
    stepHistory(this.#history, dt, this.#load, this.#random)
  }

  override draw(gfx: Gfx2D, camera: CameraView2D): void {
    const r = this.#rect
    if (r.width <= 0 || r.height <= 0) return
    const scale = camera.strokeSpaceScale()
    const rule = ruleWidth(gfx, FRAME.rulePx, scale)
    const size = Math.max(textFloor(scale), this.#cell * 0.34)
    const face = font(400, size)
    const advance = textAdvance('0', face)

    drawFrame(gfx, r, {
      color: COLORS.ruleFaint,
      width: rule,
      fill: COLORS.pane,
      title: { text: this.#title, font: face, color: COLORS.inkSoft },
    })
    if (advance <= 0) return

    const pad = this.#cell * 0.3
    const x = r.x + pad
    const w = Math.max(0, r.width - pad * 2)
    const headerY = r.y + size * 2
    const rowH = size * 1.6
    if (w <= 0) return

    this.#drawColumns(gfx, x, w, headerY, rowH, face, advance)

    const top = headerY + rowH * 2.4
    const bottom = r.y + r.height - pad
    if (bottom - top > rowH) {
      this.#drawGraph(gfx, x, w, top, bottom - top, rule)
    }
  }

  /** An inverse header strip, and the three readings under it. */
  #drawColumns(
    gfx: Gfx2D,
    x: number,
    w: number,
    y: number,
    rowH: number,
    face: string,
    advance: number,
  ): void {
    const colW = w / 3
    drawInverse(gfx, { x, y, width: w, height: rowH }, '', {
      fill: COLORS.ruleFaint,
      ink: COLORS.inkDark,
      font: face,
    })
    const values = [
      this.#history.gauge.value,
      historyPeak(this.#history),
      historyMean(this.#history),
    ]
    for (let i = 0; i < 3; i++) {
      const right = x + colW * (i + 1) - advance * 0.6
      gfx.fillText(this.#columns[i], right, capBaseline(y + rowH / 2, face), {
        font: face,
        align: 'right',
        baseline: 'alphabetic',
        color: COLORS.inkSoft,
      })
      // Through `drawRun`, because these move and a whole-string label would
      // mint a cache entry every time they did.
      drawRun(gfx, `${Math.round(values[i] * 100)}%`, {
        x: right,
        y: capBaseline(y + rowH * 1.7, face),
        font: face,
        color: i === 0 ? COLORS.ink : COLORS.inkSoft,
        advance,
        align: 'right',
      })
    }
  }

  /** The bars, newest at the right, with the peak ruled across them. */
  #drawGraph(
    gfx: Gfx2D,
    x: number,
    w: number,
    y: number,
    h: number,
    rule: number,
  ): void {
    const samples = this.#history.samples
    if (samples.length === 0) return
    const step = w / samples.length
    const barW = Math.max(rule, step * 0.72)
    for (let i = 0; i < samples.length; i++) {
      const bh = Math.max(rule, samples[i] * h)
      gfx.fillRoundRect(x + i * step, y + h - bh, barW, bh, 0, this.#accent)
    }

    const peak = historyPeak(this.#history)
    if (peak <= 0) return
    // A dashed rule at the high-water mark, so the shape has something to be
    // read against instead of floating.
    const peakY = y + h - peak * h
    gfx.strokeLine(x, peakY, x + w, peakY, {
      color: COLORS.inkSoft,
      width: rule,
      dash: [rule * 4, rule * 4],
    })
  }
}
