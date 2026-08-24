/**
 * The sections that live inside a pane: the bank, the queue and the clock.
 *
 * None of them draws a frame. The pane owns that, and each of these draws into
 * a rect the layout handed it, which is what lets a section be dropped by the
 * ladder without anything else moving.
 *
 * Each one is a caption in the chrome weight over its content in the data
 * weight, which is the whole typographic system: what a thing is recedes, what
 * it says comes forward.
 */
import {
  Node2D,
  textAdvance,
  withAlpha,
  type CameraView2D,
  type Gfx2D,
} from '@src/stargazer'
import { font } from '../../fonts'
import { formatClock, isUrgent, START_SECONDS } from '../countdown'
import { textFloor } from '../layout'
import { accentForLevel, ANIM, COLORS, FRAME } from '../tuning'
import type { Bounds, PieceKind } from '../types'
import { drawPieceCentered } from './cells'
import { capBaseline, drawMeter, drawRun, ruleWidth, withGlow } from './tui'

const ZERO: Bounds = { x: 0, y: 0, width: 0, height: 0 }

/**
 * Blocks in the clock's meter. Enough to read a second off, few enough to
 * count.
 */
const CLOCK_CELLS = 18

/** A section's caption, and the rect left under it for the content. */
function drawCaption(
  gfx: Gfx2D,
  rect: Bounds,
  scale: number,
  cell: number,
  caption: string,
): Bounds {
  const size = Math.max(textFloor(scale), cell * 0.36)
  const band = size * 1.7
  gfx.fillText(
    caption,
    rect.x,
    capBaseline(rect.y + band / 2, font(400, size)),
    {
      font: font(400, size),
      align: 'left',
      baseline: 'alphabetic',
      color: COLORS.inkSoft,
    },
  )
  return {
    x: rect.x,
    y: rect.y + band,
    width: rect.width,
    height: Math.max(0, rect.height - band),
  }
}

/** The banked piece, or an empty slot. */
export class HoldPanelNode extends Node2D {
  #rect: Bounds = ZERO
  #cell = 1
  #kind: PieceKind | null = null
  #spent = false
  #caption = 'bank'

  constructor() {
    super('bo-hold')
    this.renderLayer = 'dynamic'
  }

  setCaption(caption: string): void {
    this.#caption = caption
  }

  setRect(rect: Bounds, cell: number): void {
    this.#rect = rect
    this.#cell = cell
    this.debugBounds = { ...rect }
  }

  set(kind: PieceKind | null, spent: boolean): void {
    this.#kind = kind
    this.#spent = spent
  }

  override draw(gfx: Gfx2D, camera: CameraView2D): void {
    const r = this.#rect
    if (r.width <= 0 || r.height <= 0) return
    const body = drawCaption(
      gfx,
      r,
      camera.strokeSpaceScale(),
      this.#cell,
      this.#caption,
    )
    if (!this.#kind) return
    // Spent dims the piece rather than hiding it, so the player can still see
    // what is waiting there for the next piece.
    if (this.#spent) gfx.setAlpha(0.35)
    drawPieceCentered(
      gfx,
      this.#kind,
      body.x,
      body.y,
      body.width,
      body.height,
      this.#cell * 0.72,
    )
    if (this.#spent) gfx.setAlpha(1)
  }
}

/**
 * The queue, as a numbered list.
 *
 * A process table rather than a stack of floating shapes, which is both the
 * house idiom here and easier to count: the row number says how many pieces
 * away a shape is without anyone having to work it out.
 */
export class NextQueueNode extends Node2D {
  #rect: Bounds = ZERO
  #cell = 1
  #queue: readonly PieceKind[] = []
  #count = 5
  #caption = 'queue'

  constructor() {
    super('bo-next')
    this.renderLayer = 'dynamic'
  }

  setCaption(caption: string): void {
    this.#caption = caption
  }

  setRect(rect: Bounds, cell: number): void {
    this.#rect = rect
    this.#cell = cell
    this.debugBounds = { ...rect }
  }

  /** How many rows the ladder left room for. */
  setCount(count: number): void {
    this.#count = Math.max(1, count)
  }

  set(queue: readonly PieceKind[]): void {
    this.#queue = queue
  }

  override draw(gfx: Gfx2D, camera: CameraView2D): void {
    const r = this.#rect
    if (r.width <= 0 || r.height <= 0) return
    const scale = camera.strokeSpaceScale()
    const body = drawCaption(gfx, r, scale, this.#cell, this.#caption)
    const shown = Math.min(this.#count, this.#queue.length)
    if (shown <= 0 || body.height <= 0) return

    const rowH = body.height / this.#count
    const size = Math.max(textFloor(scale), rowH * 0.32)
    const numberFont = font(400, size)
    const indexW = textAdvance('0', numberFont) * 2.4

    for (let i = 0; i < shown; i++) {
      const y = body.y + i * rowH
      // A faint stripe on alternate rows, which is what stops a table of five
      // near-identical rows reading as one block.
      if (i % 2 === 1) {
        gfx.fillRoundRect(body.x, y, body.width, rowH, 0, COLORS.ruleFaint)
      }
      gfx.fillText(
        String(i + 1),
        body.x + indexW * 0.6,
        capBaseline(y + rowH / 2, numberFont),
        {
          font: numberFont,
          align: 'right',
          baseline: 'alphabetic',
          color: COLORS.ruleFaint,
        },
      )
      // The piece next up is at full strength. The rest step back so the eye
      // lands on the one that matters.
      if (i > 0) gfx.setAlpha(0.72)
      drawPieceCentered(
        gfx,
        this.#queue[i],
        body.x + indexW,
        y + rowH * 0.12,
        body.width - indexW,
        rowH * 0.76,
        this.#cell * (i === 0 ? 0.6 : 0.48),
      )
      if (i > 0) gfx.setAlpha(1)
    }
  }
}

/**
 * Countdown's clock, as a draining meter.
 *
 * A meter rather than a number alone because the mode is about a quantity
 * running out, and a bar shows how much is left without being read. The digits
 * stay for the last few seconds, when exactly how much is left is the thing the
 * player is playing against.
 */
export class ClockNode extends Node2D {
  #rect: Bounds = ZERO
  #cell = 1
  #remaining = START_SECONDS
  #accent = accentForLevel(1)
  #caption = 'clock'
  #grant = 0
  #grantT = 1

  constructor() {
    super('bo-clock')
    this.renderLayer = 'dynamic'
  }

  setCaption(caption: string): void {
    this.#caption = caption
  }

  setRect(rect: Bounds, cell: number): void {
    this.#rect = rect
    this.#cell = cell
    this.debugBounds = { ...rect }
  }

  setRemaining(seconds: number): void {
    this.#remaining = seconds
  }

  setLevel(level: number): void {
    this.#accent = accentForLevel(level)
  }

  /** A clear just bought `seconds`, which floats up off the meter. */
  granted(seconds: number): void {
    if (seconds <= 0) return
    this.#grant = seconds
    this.#grantT = 0
  }

  override onUpdate(dt: number): void {
    if (this.#grantT < 1) {
      this.#grantT = Math.min(
        1,
        this.#grantT + dt / (ANIM.banner + ANIM.bannerHold),
      )
    }
  }

  override draw(gfx: Gfx2D, camera: CameraView2D): void {
    const r = this.#rect
    if (r.width <= 0 || r.height <= 0) return
    const scale = camera.strokeSpaceScale()
    const rule = ruleWidth(gfx, FRAME.rulePx, scale)
    const urgent = isUrgent(this.#remaining)
    const lit = urgent ? COLORS.ink : this.#accent

    const size = Math.max(textFloor(scale), this.#cell * 0.36)
    const capFont = font(400, size)
    const valueSize = Math.max(textFloor(scale) * 1.5, this.#cell * 0.62)
    const valueFont = font(700, valueSize)
    const baseline = capBaseline(r.y + valueSize * 0.62, valueFont)

    gfx.fillText(
      this.#caption,
      r.x,
      capBaseline(r.y + valueSize * 0.62, capFont),
      {
        font: capFont,
        align: 'left',
        baseline: 'alphabetic',
        color: COLORS.inkSoft,
      },
    )
    drawRun(gfx, formatClock(this.#remaining), {
      x: r.x + r.width,
      y: baseline,
      font: valueFont,
      color: lit,
      advance: textAdvance('0', valueFont),
      align: 'right',
    })

    const meter: Bounds = {
      x: r.x,
      y: r.y + valueSize * 1.05,
      width: r.width,
      height: Math.max(rule * 3, this.#cell * 0.24),
    }
    const paint = (): void =>
      drawMeter(gfx, meter, {
        value: this.#remaining,
        max: START_SECONDS,
        cells: CLOCK_CELLS,
        color: lit,
        trackColor: COLORS.ruleFaint,
        bracket: { color: COLORS.rule, width: rule },
      })
    // One of the three surfaces allowed a phosphor pass, and it earns it: the
    // last ten seconds are the only moment the mode asks to be looked at.
    if (urgent) withGlow(gfx, rule, paint)
    else paint()

    if (this.#grantT < 1) this.#drawGrant(gfx, r, valueFont, lit)
  }

  #drawGrant(gfx: Gfx2D, r: Bounds, valueFont: string, color: string): void {
    const fade = 1 - this.#grantT
    gfx.setAlpha(fade * fade)
    gfx.fillText(
      `+${Math.round(this.#grant)}`,
      r.x + r.width,
      r.y - r.height * this.#grantT * 0.45,
      {
        font: valueFont,
        align: 'right',
        baseline: 'alphabetic',
        color: withAlpha(color, 1),
      },
    )
    gfx.setAlpha(1)
  }
}
