/**
 * A scrolling feed of what the run has just done.
 *
 * The most recognisable thing a terminal does that a game normally does not:
 * keep a record. It also does a job the centre banner cannot, which is to still
 * be there a second later, so a player who was watching their piece land can
 * find out what the flash was.
 *
 * Timestamps come from a clock this node keeps itself, accumulated in
 * `onUpdate` and therefore paused with the game. Uptime has no clock of its own
 * and does not need one added to the session just for this.
 *
 * The row form adapts to the pane rather than the pane to the row: a narrow
 * seat drops the stamp and keeps the label, because which event fired is the
 * information and when it fired is not.
 */
import {
  Node2D,
  textAdvance,
  type CameraView2D,
  type Gfx2D,
} from '@src/stargazer'
import { font } from '../../fonts'
import {
  formatEntry,
  pushEntry,
  type LogEntry,
  type LogTone,
} from '../eventLog'
import { textFloor } from '../layout'
import { accentForLevel, ANIM, COLORS } from '../tuning'
import type { Bounds } from '../types'
import { capBaseline } from './tui'

const ZERO: Bounds = { x: 0, y: 0, width: 0, height: 0 }

/** Characters a row needs before a stamp is worth its width. */
const STAMPED_CHARS = 20

export class EventLogNode extends Node2D {
  #rect: Bounds = ZERO
  #cell = 1
  #caption = 'events'
  #rows = 0
  #log: LogEntry[] = []
  #elapsed = 0
  #accent = accentForLevel(1)
  /** Fades the newest row in, so an arrival is visible without being loud. */
  #freshT = 1

  constructor() {
    super('bo-log')
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

  /** How many rows the ladder left room for. Zero hides the section. */
  setRows(rows: number): void {
    this.#rows = Math.max(0, rows)
    this.#log = this.#log.slice(-Math.max(1, this.#rows))
  }

  setLevel(level: number): void {
    this.#accent = accentForLevel(level)
  }

  /** Seconds this run has been going, which is what stamps a row. */
  get elapsed(): number {
    return this.#elapsed
  }

  push(label: string, points = 0, tone: LogTone = 'plain'): void {
    if (this.#rows <= 0) return
    this.#log = pushEntry(
      this.#log,
      { at: this.#elapsed, label, points, tone },
      this.#rows,
    )
    this.#freshT = 0
  }

  reset(): void {
    this.#log = []
    this.#elapsed = 0
    this.#freshT = 1
  }

  override onUpdate(dt: number): void {
    this.#elapsed += dt
    if (this.#freshT < 1) {
      this.#freshT = Math.min(1, this.#freshT + dt / ANIM.scoreCount)
    }
  }

  override draw(gfx: Gfx2D, camera: CameraView2D): void {
    const r = this.#rect
    if (r.width <= 0 || r.height <= 0 || this.#rows <= 0) return
    const scale = camera.strokeSpaceScale()
    const size = Math.max(textFloor(scale), this.#cell * 0.36)
    const capFont = font(400, size)
    const band = size * 1.7

    gfx.fillText(this.#caption, r.x, capBaseline(r.y + band / 2, capFont), {
      font: capFont,
      align: 'left',
      baseline: 'alphabetic',
      color: COLORS.inkSoft,
    })

    const bodyY = r.y + band
    const bodyH = r.height - band
    if (bodyH <= 0 || this.#log.length === 0) return

    const rowFont = font(400, size)
    const advance = textAdvance('0', rowFont)
    const withTime = advance > 0 && r.width >= advance * STAMPED_CHARS
    const rowH = bodyH / this.#rows

    // Bottom anchored, so a run that has only just started does not float its
    // two rows in the middle of the section.
    const first = this.#rows - this.#log.length
    for (let i = 0; i < this.#log.length; i++) {
      const entry = this.#log[i]
      const line = formatEntry(entry, withTime)
      const y = capBaseline(bodyY + (first + i + 0.5) * rowH, rowFont)
      const newest = i === this.#log.length - 1
      if (newest && this.#freshT < 1) gfx.setAlpha(this.#freshT)
      gfx.fillText(line.left, r.x, y, {
        font: rowFont,
        align: 'left',
        baseline: 'alphabetic',
        color: this.#toneColor(entry.tone),
      })
      if (line.right) {
        gfx.fillText(line.right, r.x + r.width, y, {
          font: rowFont,
          align: 'right',
          baseline: 'alphabetic',
          color: COLORS.inkSoft,
        })
      }
      if (newest && this.#freshT < 1) gfx.setAlpha(1)
    }
  }

  #toneColor(tone: LogTone): string {
    if (tone === 'accent') return this.#accent
    if (tone === 'warn') return COLORS.ink
    return COLORS.inkSoft
  }
}
