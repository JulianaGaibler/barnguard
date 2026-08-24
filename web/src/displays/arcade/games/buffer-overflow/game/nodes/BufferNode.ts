/**
 * The buffer: a framed field, a hairline grid inside it, the locked stack, and
 * a rule whose accent climbs with the level.
 *
 * Reads the session's buffer directly each frame rather than keeping a copy.
 * There are two hundred cells and the array is already there, so a mirror would
 * be one more thing to keep in step for no gain.
 *
 * The frame's title carries the seat's identity, which is why there is no
 * separate player label anywhere on the board.
 */
import {
  Node2D,
  easings,
  withAlpha,
  type CameraView2D,
  type Gfx2D,
} from '@src/stargazer'
import { VISIBLE_TOP, visibleRows, type Buffer } from '../board'
import { font } from '../../fonts'
import { textFloor } from '../layout'
import { accentForLevel, ANIM, CLEAR_FLASH, COLORS, FRAME } from '../tuning'
import type { Bounds } from '../types'
import { drawCell } from './cells'
import { drawFrame, ruleWidth } from './tui'

/** Corner brackets inside the frame, as a fraction of a cell. */
const MARK_FRAC = 0.5
/** A tick every this many rows, with a number on every second one. */
const TICK_EVERY = 4
const SHAKE_DECAY_PER_SEC = 9

const ZERO: Bounds = { x: 0, y: 0, width: 0, height: 0 }

export class BufferNode extends Node2D {
  #rect: Bounds = ZERO
  #frame: Bounds = ZERO
  #cell = 1
  #buffer: Buffer | null = null
  #accent = accentForLevel(1)
  #title = ''
  #trailing = ''
  #titleColor: string | null = null
  #ticks = false

  /** Rows mid-clear, drawn as a flash. Cleared once the collapse lands. */
  #flashing: number[] = []
  #flashT = 0

  #shake = 0
  #shakePhase = 0
  /** Dims the whole stack once the run is over. */
  #dimmed = false

  constructor() {
    super('bo-buffer')
    this.renderLayer = 'dynamic'
  }

  setBuffer(buffer: Buffer): void {
    this.#buffer = buffer
  }

  setRect(rect: Bounds, frame: Bounds, cell: number): void {
    this.#rect = rect
    this.#frame = frame
    this.#cell = cell
    this.debugBounds = { ...frame }
  }

  /**
   * What the top rule reads.
   *
   * Solo takes a device path and the buffer's dimensions. A race takes the seat
   * name in the seat's colour, which is the whole of how a player finds their
   * own half.
   */
  setTitle(title: string, trailing: string, color?: string): void {
    this.#title = title
    this.#trailing = trailing
    this.#titleColor = color ?? null
  }

  setTicks(ticks: boolean): void {
    this.#ticks = ticks
  }

  setLevel(level: number): void {
    this.#accent = accentForLevel(level)
  }

  setDimmed(dimmed: boolean): void {
    this.#dimmed = dimmed
  }

  /** Flash `rows` until {@link clearFlash} is called. */
  flashRows(rows: readonly number[]): void {
    this.#flashing = [...rows]
    this.#flashT = 0
  }

  clearFlash(): void {
    this.#flashing = []
  }

  /** A knock proportional to how much came out at once. */
  shake(rows: number): void {
    this.#shake = Math.max(this.#shake, rows * ANIM.shakePerRow)
  }

  override onUpdate(dt: number): void {
    if (this.#flashing.length > 0) {
      this.#flashT = Math.min(1, this.#flashT + dt / ANIM.clearFlash)
    }
    if (this.#shake > 0) {
      this.#shakePhase += dt * 44
      this.#shake = Math.max(
        0,
        this.#shake - SHAKE_DECAY_PER_SEC * dt * this.#shake,
      )
      if (this.#shake < 0.05) {
        this.#shake = 0
        this.#shakePhase = 0
      }
    }
  }

  override draw(gfx: Gfx2D, camera: CameraView2D): void {
    const r = this.#rect
    const cell = this.#cell
    if (cell <= 0 || !this.#buffer) return

    const scale = camera.strokeSpaceScale()
    const rule = ruleWidth(gfx, FRAME.rulePx, scale)
    const size = Math.max(textFloor(scale), cell * 0.4)
    const labelFont = font(400, size)

    const shaking = this.#shake > 0
    if (shaking) {
      gfx.save()
      // Two frequencies, so the wobble never repeats on itself.
      gfx.translate(
        Math.sin(this.#shakePhase) * this.#shake,
        Math.cos(this.#shakePhase * 1.3) * this.#shake * 0.5,
      )
    }

    drawFrame(gfx, this.#frame, {
      color: this.#accent,
      width: rule,
      fill: COLORS.buffer,
      title: this.#title
        ? {
            text: this.#title,
            font: labelFont,
            color: this.#titleColor ?? COLORS.inkSoft,
          }
        : undefined,
      trailing: this.#trailing
        ? { text: this.#trailing, font: labelFont, color: COLORS.ruleFaint }
        : undefined,
    })
    this.#drawCornerMarks(gfx, cell, rule)
    this.#drawGrid(gfx, r, cell)
    this.#drawStack(gfx, r, cell)
    if (this.#ticks) this.#drawTicks(gfx, r, cell, rule, labelFont)

    if (shaking) gfx.restore()
  }

  /**
   * A short bracket inside each corner of the frame.
   *
   * Two strokes rather than one path per corner, drawn opaque: an L drawn as a
   * single polyline would double-blend at the elbow at this alpha and show as a
   * darker notch.
   */
  #drawCornerMarks(gfx: Gfx2D, cell: number, rule: number): void {
    const f = this.#frame
    const len = cell * MARK_FRAC
    const inset = rule * 2.5
    const color = withAlpha(COLORS.ink, 0.28)
    const style = { color, width: rule, cap: 'butt' as const }
    for (const [x, dx] of [
      [f.x + inset, 1],
      [f.x + f.width - inset, -1],
    ] as const) {
      for (const [y, dy] of [
        [f.y + inset, 1],
        [f.y + f.height - inset, -1],
      ] as const) {
        gfx.strokeLine(x, y, x + dx * len, y, style)
        gfx.strokeLine(x, y, x, y + dy * len, style)
      }
    }
  }

  /**
   * The grid, sized from the buffer rather than from the game's own dimensions,
   * so a smaller buffer draws a smaller grid instead of ruling lines out past
   * its own rim.
   */
  #drawGrid(gfx: Gfx2D, r: Bounds, cell: number): void {
    const b = this.#buffer
    if (!b) return
    const style = { color: COLORS.grid, width: 1 }
    for (let c = 1; c < b.cols; c++) {
      const x = r.x + c * cell
      gfx.strokeLine(x, r.y, x, r.y + r.height, style)
    }
    for (let row = 1; row < visibleRows(b); row++) {
      const y = r.y + row * cell
      gfx.strokeLine(r.x, y, r.x + r.width, y, style)
    }
  }

  /** A ruler down the right rule, so the stack's height can be read off. */
  #drawTicks(
    gfx: Gfx2D,
    r: Bounds,
    cell: number,
    rule: number,
    labelFont: string,
  ): void {
    const b = this.#buffer
    if (!b) return
    const rows = visibleRows(b)
    const style = { color: COLORS.ruleFaint, width: rule, cap: 'butt' as const }
    const right = r.x + r.width
    for (let row = TICK_EVERY; row < rows; row += TICK_EVERY) {
      const y = r.y + row * cell
      const long = row % (TICK_EVERY * 2) === 0
      gfx.strokeLine(right - cell * (long ? 0.34 : 0.2), y, right, y, style)
      if (!long) continue
      gfx.fillText(
        String(row),
        this.#frame.x + this.#frame.width + rule * 3,
        y,
        {
          font: labelFont,
          align: 'left',
          baseline: 'middle',
          color: COLORS.ruleFaint,
        },
      )
    }
  }

  #drawStack(gfx: Gfx2D, r: Bounds, cell: number): void {
    const b = this.#buffer
    if (!b) return
    // Flashing rows blow out to white and then fade, which is what reads as the
    // row being consumed rather than simply vanishing.
    const flash = this.#flashing.length ? 1 - easings.inQuad(this.#flashT) : 0

    if (this.#dimmed) gfx.setAlpha(0.45)
    for (let row = VISIBLE_TOP; row < b.rows; row++) {
      const y = r.y + (row - VISIBLE_TOP) * cell
      const lit = flash > 0 && this.#flashing.includes(row)
      for (let col = 0; col < b.cols; col++) {
        const kind = b.cells[row * b.cols + col]
        if (!kind) continue
        const x = r.x + col * cell
        drawCell(gfx, kind, x, y, cell)
        if (lit) {
          gfx.setAlpha(flash)
          gfx.fillRoundRect(x, y, cell, cell, 0, CLEAR_FLASH)
          gfx.setAlpha(this.#dimmed ? 0.45 : 1)
        }
      }
    }
    if (this.#dimmed) gfx.setAlpha(1)
  }
}
