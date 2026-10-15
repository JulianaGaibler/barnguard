/**
 * A readout: a caption in the chrome weight, its value large and right-aligned
 * in the data weight, and for the level a meter of how far the next one is.
 *
 * Draws into a section of a pane, so it owns no frame. Four accents, each on
 * its own clock so nothing can drift.
 *
 * A change flashes the value inverse, which is how a terminal marks a field
 * that just moved. That flash replaces the quarter-turn the arcade version
 * spun, because there is no longer a square to turn and a terminal would not
 * turn one.
 *
 * The whole readout kicks in scale on a change, which is what catches the eye
 * at the edge of vision while the player is watching the buffer, and a gain
 * floats up and fades, so a jump of eight hundred says how much it was rather
 * than only that it happened.
 *
 * Every accent is a different picture on each frame it runs, so the node paints
 * every frame while one is live, which is under a second after a change, and
 * rests otherwise.
 */
import { Node2D, easings, textAdvance, type Canvas } from '@src/stargazer'
import { font } from '../../fonts'
import { textFloor, valueFloor } from '../layout'
import { accentForLevel, ANIM, COLORS, FRAME } from '../tuning'
import type { Bounds } from '../types'
import { capBaseline, drawMeter, drawRun, ruleWidth, sameBounds } from './tui'

const FLASH_SEC = 0.5
const KICK_SEC = 0.32
const GAIN_SEC = 0.9

/** How far the readout swells on a change. */
const KICK_SCALE = 0.06

/** Blocks in the level's progress meter, one per line to the next level. */
const METER_CELLS = 10

const ZERO: Bounds = { x: 0, y: 0, width: 0, height: 0 }

export interface StatBadgeOptions {
  label: string
  /** Show a floating `+N` when the value climbs. Wanted on a score, not a level. */
  showGain?: boolean
  /** Count up to a new value instead of jumping. */
  countUp?: boolean
  /** Carry a progress meter under the value. */
  meter?: boolean
}

export class StatBadgeNode extends Node2D {
  readonly #label: string
  readonly #showGain: boolean
  readonly #countUp: boolean
  readonly #meter: boolean

  #rect: Bounds = ZERO
  #cell = 1
  #accent = accentForLevel(1)

  /** The value being counted toward, and the one currently drawn. */
  #target = 0
  #from = 0
  #shown = 0
  #countT = 1

  #flashT = 1
  #kickT = 1
  #gain = 0
  #gainT = 1

  #progress = 0
  #progressMax = 1

  constructor(opts: StatBadgeOptions) {
    super(`bo-stat-${opts.label.toLowerCase()}`)
    this.#label = opts.label
    this.#showGain = opts.showGain ?? false
    this.#countUp = opts.countUp ?? false
    this.#meter = opts.meter ?? false
  }

  setRect(rect: Bounds, cell: number): void {
    if (sameBounds(rect, this.#rect) && cell === this.#cell) return
    this.#rect = { ...rect }
    this.#cell = cell
    this.markNeedsPaint()
  }

  setLevel(level: number): void {
    const accent = accentForLevel(level)
    if (accent === this.#accent) return
    this.#accent = accent
    this.markNeedsPaint()
  }

  /** How far along the next step this readout is, for a metered one. */
  setProgress(value: number, max: number): void {
    const progressMax = Math.max(1, max)
    if (value === this.#progress && progressMax === this.#progressMax) return
    this.#progress = value
    this.#progressMax = progressMax
    if (this.#meter) this.markNeedsPaint()
  }

  /** Move to `value`, running whichever accents this readout was built with. */
  set(value: number): void {
    if (value === this.#target) return
    const gain = value - this.#target
    this.#from = this.#shown
    this.#target = value
    this.#countT = this.#countUp ? 0 : 1
    if (!this.#countUp) this.#shown = value

    this.#flashT = 0
    this.#kickT = 0
    if (this.#showGain && gain > 0) {
      this.#gain = gain
      this.#gainT = 0
    }
    this.markNeedsPaint()
  }

  /** Jump to `value` with no accents, for a fresh run. */
  reset(value: number): void {
    this.#target = value
    this.#from = value
    this.#shown = value
    this.#countT = 1
    this.#flashT = 1
    this.#kickT = 1
    this.#gainT = 1
    this.#progress = 0
    this.markNeedsPaint()
  }

  override onUpdate(dt: number): void {
    const live =
      this.#countT < 1 || this.#flashT < 1 || this.#kickT < 1 || this.#gainT < 1
    if (live) this.markNeedsPaint()
    if (this.#countT < 1) {
      this.#countT = Math.min(1, this.#countT + dt / ANIM.scoreCount)
      const eased = easings.outCubic(this.#countT)
      this.#shown = Math.round(this.#from + (this.#target - this.#from) * eased)
    }
    if (this.#flashT < 1)
      this.#flashT = Math.min(1, this.#flashT + dt / FLASH_SEC)
    if (this.#kickT < 1) this.#kickT = Math.min(1, this.#kickT + dt / KICK_SEC)
    if (this.#gainT < 1) this.#gainT = Math.min(1, this.#gainT + dt / GAIN_SEC)
  }

  override paint(gfx: Canvas): void {
    const r = this.#rect
    if (r.width <= 0 || r.height <= 0) return
    const scale = gfx.screenScale()
    const rule = ruleWidth(gfx, FRAME.rulePx)

    const capSize = Math.max(textFloor(scale), this.#cell * 0.36)
    const capFont = font(400, capSize)
    const valueSize = Math.max(valueFloor(scale), this.#cell * 0.78)
    const valueFont = font(700, valueSize)
    const advance = textAdvance('0', valueFont)
    const text = String(this.#shown)

    // The kick scales the whole readout about its own centre, so the caption
    // and the number swell together instead of sliding against each other.
    const kick =
      this.#kickT < 1
        ? Math.sin(this.#kickT * Math.PI) * KICK_SCALE * (1 - this.#kickT * 0.3)
        : 0
    const cx = r.x + r.width / 2
    const cy = r.y + r.height / 2
    gfx.save()
    if (kick !== 0) {
      gfx.translate(cx, cy)
      gfx.scale(1 + kick, 1 + kick)
      gfx.translate(-cx, -cy)
    }

    const rowY = r.y + valueSize * 0.62
    gfx.fillText(this.#label, r.x, capBaseline(rowY, capFont), {
      font: capFont,
      align: 'left',
      baseline: 'alphabetic',
      color: COLORS.inkSoft,
    })
    this.#drawValue(
      gfx,
      text,
      r,
      valueFont,
      advance,
      capBaseline(rowY, valueFont),
      valueSize,
    )

    if (this.#meter) {
      const meter: Bounds = {
        x: r.x,
        y: r.y + valueSize * 1.12,
        width: r.width,
        height: Math.max(rule * 3, this.#cell * 0.22),
      }
      drawMeter(gfx, meter, {
        value: this.#progress,
        max: this.#progressMax,
        cells: METER_CELLS,
        color: this.#accent,
        trackColor: COLORS.ruleFaint,
        bracket: { color: COLORS.rule, width: rule },
      })
    }
    gfx.restore()

    // Outside the kick, so a gain rises at a steady size while the readout
    // swells and settles underneath it.
    if (this.#gainT < 1) this.#drawGain(gfx, r, capFont)
  }

  /**
   * The value, flashing inverse when it has just changed.
   *
   * Drawn twice in two fixed colours and cross-faded, never once in a colour
   * that animates. A label's colour is baked into its cached bitmap, so a
   * changing colour re-rasterizes the whole run every frame it moves, against a
   * budget of twenty-four rasterizations a frame. Alpha rides the instance tint
   * and costs nothing.
   */
  #drawValue(
    gfx: Canvas,
    text: string,
    r: Bounds,
    valueFont: string,
    advance: number,
    baseline: number,
    valueSize: number,
  ): void {
    const flash = this.#flashT < 1 ? 1 - easings.outCubic(this.#flashT) : 0
    const right = r.x + r.width
    const run = (color: string): void =>
      drawRun(gfx, text, {
        x: right,
        y: baseline,
        font: valueFont,
        color,
        advance,
        align: 'right',
      })

    if (flash <= 0) {
      run(COLORS.ink)
      return
    }

    const w = advance * text.length
    const pad = advance * 0.3
    gfx.setAlpha(flash)
    gfx.fillRoundRect(
      right - w - pad,
      baseline - valueSize * 0.78,
      w + pad * 2,
      valueSize * 1.06,
      0,
      this.#accent,
    )
    gfx.setAlpha(1 - flash)
    run(COLORS.ink)
    gfx.setAlpha(flash)
    run(COLORS.inkDark)
    gfx.setAlpha(1)
  }

  #drawGain(gfx: Canvas, r: Bounds, capFont: string): void {
    const fade = 1 - this.#gainT
    gfx.setAlpha(fade * fade)
    gfx.fillText(
      `+${this.#gain}`,
      r.x + r.width,
      r.y - r.height * this.#gainT * 0.4,
      {
        font: capFont,
        align: 'right',
        baseline: 'alphabetic',
        color: this.#accent,
      },
    )
    gfx.setAlpha(1)
  }
}
