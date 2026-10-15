/**
 * A window of ambient readings: an inverse column header, a stack of meters,
 * and optionally a build creeping along under them.
 *
 * Solo only. It exists because the buffer cannot grow into the width a solo
 * game has spare, so the choice is between filling that space and leaving it
 * looking empty. What fills it is the rest of the machine the game pretends to
 * run on, which is the one thing that can sit beside a terminal application
 * without looking like an ornament.
 *
 * It draws its own frame rather than sitting inside a `PaneNode`, so the whole
 * window is one node and one `transform.alpha` holds it behind everything that
 * matters. Nothing in here calls `setAlpha`, which is what lets that hold.
 *
 * Nothing it shows is load-bearing and nothing it shows moves quickly. The
 * numbers all come from {@link stepTelemetry}, which is where the pacing lives.
 * The pane paints again only when a drawn number or a lit meter cell changes,
 * which is a few times a second at most.
 */
import { Node2D, textAdvance, type Canvas } from '@src/stargazer'
import { font } from '../../fonts'
import { MAX_LEVEL } from '../gravity'
import { textFloor } from '../layout'
import {
  createTelemetry,
  loadFor,
  stepTelemetry,
  type Telemetry,
} from '../telemetry'
import { accentForLevel, COLORS, FRAME } from '../tuning'
import type { Bounds } from '../types'
import {
  capBaseline,
  drawInverse,
  drawFrame,
  drawMeter,
  drawRun,
  meterCells,
  ruleWidth,
  sameBounds,
} from './tui'

const ZERO: Bounds = { x: 0, y: 0, width: 0, height: 0 }

/** Blocks in a reading's meter. */
const METER_CELLS = 12
/** How far back the whole column sits. */
const DIM = 0.5

export interface TelemetryPaneOptions {
  title: string
  /** The inverse strip under the title. Both ends are labelled. */
  header: { left: string; right: string }
  /** Labelled meters, one row each. */
  gauges: readonly string[]
  /** A build block under them: what is being made, how far along, how long. */
  job?: boolean
  seed: number
}

export class TelemetryPaneNode extends Node2D {
  readonly #title: string
  readonly #header: { left: string; right: string }
  readonly #job: boolean
  readonly #telemetry: Telemetry

  #rect: Bounds = ZERO
  #cell = 1
  #accent = accentForLevel(1)
  #load = 0
  /** What each reading drew last, so an update can tell if it moved. */
  readonly #drawn: number[] = []
  #drawnJob = -1

  constructor(opts: TelemetryPaneOptions) {
    super(`bo-aside-${opts.title}`)
    this.#title = opts.title
    this.#header = opts.header
    this.#job = opts.job ?? false
    this.#telemetry = createTelemetry(opts.gauges, opts.seed)
    this.transform.alpha = DIM
  }

  setRect(rect: Bounds, cell: number): void {
    if (sameBounds(rect, this.#rect) && cell === this.#cell) return
    this.#rect = { ...rect }
    this.#cell = cell
    this.markNeedsPaint()
  }

  setLevel(level: number): void {
    const accent = accentForLevel(level)
    this.#load = loadFor(level, MAX_LEVEL)
    if (accent === this.#accent) return
    this.#accent = accent
    this.markNeedsPaint()
  }

  override onUpdate(dt: number): void {
    if (this.#rect.width <= 0) return
    const t = this.#telemetry
    stepTelemetry(t, dt, this.#load)
    let moved = false
    for (let i = 0; i < t.gauges.length; i++) {
      const v = t.gauges[i].value
      const key = Math.round(v * 100) * 64 + meterCells(v, 1, METER_CELLS)
      if (key !== this.#drawn[i]) {
        this.#drawn[i] = key
        moved = true
      }
    }
    const job = t.job
    const left = Math.max(0, Math.ceil(job.duration - job.elapsed))
    const jobKey =
      (job.index * 100 + left) * 64 +
      meterCells(job.progress, 1, METER_CELLS * 2)
    if (jobKey !== this.#drawnJob) {
      this.#drawnJob = jobKey
      moved = this.#job || moved
    }
    if (moved) this.markNeedsPaint()
  }

  override paint(gfx: Canvas): void {
    const r = this.#rect
    if (r.width <= 0 || r.height <= 0) return
    const scale = gfx.screenScale()
    const rule = ruleWidth(gfx, FRAME.rulePx)
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
    if (w <= 0) return

    const headerH = size * 1.6
    const headerY = r.y + size * 2
    this.#drawHeader(gfx, x, w, headerY, headerH, face)

    const top = headerY + headerH * 1.35
    const bottom = r.y + r.height - pad
    const jobRows = this.#job ? 2.6 : 0
    const gauges = this.#telemetry.gauges
    const slots = gauges.length + jobRows
    if (slots <= 0 || bottom <= top) return
    const rowH = (bottom - top) / slots

    // A label column wide enough for the longest name, so every meter starts at
    // the same x and the stack reads as a table.
    const labelW = advance * 6
    for (let i = 0; i < gauges.length; i++) {
      const g = gauges[i]
      const y = top + i * rowH
      this.#label(gfx, g.label, x, y, rowH, face, COLORS.ruleFaint)
      drawMeter(
        gfx,
        {
          x: x + labelW,
          y: y + rowH * 0.34,
          width: w - labelW - advance * 4,
          height: rowH * 0.32,
        },
        {
          value: g.value,
          max: 1,
          cells: METER_CELLS,
          color: this.#accent,
          trackColor: COLORS.ruleFaint,
        },
      )
      drawRun(gfx, `${Math.round(g.value * 100)}%`, {
        x: x + w,
        y: capBaseline(y + rowH / 2, face),
        font: face,
        color: COLORS.inkSoft,
        advance,
        align: 'right',
      })
    }

    if (this.#job) {
      this.#drawJob(
        gfx,
        x,
        w,
        top + gauges.length * rowH,
        rowH,
        face,
        advance,
        rule,
      )
    }
  }

  #drawHeader(
    gfx: Canvas,
    x: number,
    w: number,
    y: number,
    h: number,
    face: string,
  ): void {
    drawInverse(gfx, { x, y, width: w, height: h }, this.#header.left, {
      fill: COLORS.ruleFaint,
      ink: COLORS.ink,
      font: face,
      align: 'left',
    })
    gfx.fillText(
      this.#header.right,
      x + w * 0.94,
      capBaseline(y + h / 2, face),
      {
        font: face,
        align: 'right',
        baseline: 'alphabetic',
        color: COLORS.ink,
      },
    )
  }

  #label(
    gfx: Canvas,
    text: string,
    x: number,
    y: number,
    rowH: number,
    face: string,
    color: string,
  ): void {
    gfx.fillText(text, x, capBaseline(y + rowH / 2, face), {
      font: face,
      align: 'left',
      baseline: 'alphabetic',
      color,
    })
  }

  /** What is being built, how far along, and how much of it is left. */
  #drawJob(
    gfx: Canvas,
    x: number,
    w: number,
    y: number,
    rowH: number,
    face: string,
    advance: number,
    rule: number,
  ): void {
    const job = this.#telemetry.job
    this.#label(gfx, job.label, x, y, rowH, face, COLORS.inkSoft)
    const left = Math.max(0, Math.ceil(job.duration - job.elapsed))
    drawRun(gfx, `${left}s`, {
      x: x + w,
      y: capBaseline(y + rowH / 2, face),
      font: face,
      color: COLORS.ruleFaint,
      advance,
      align: 'right',
    })
    drawMeter(
      gfx,
      {
        x,
        y: y + rowH * 1.2,
        width: w,
        height: Math.max(rule * 3, rowH * 0.3),
      },
      {
        value: job.progress,
        max: 1,
        cells: METER_CELLS * 2,
        color: COLORS.inkSoft,
        trackColor: COLORS.ruleFaint,
      },
    )
  }
}
