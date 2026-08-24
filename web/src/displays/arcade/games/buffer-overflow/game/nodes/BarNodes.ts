/**
 * The strips that close the top and bottom of the window.
 *
 * A framed input band alone leaves a composition. A title bar above it and a
 * status line below make it an application. Both are region-wide and neither is
 * interactive, so they carry no hit rect and may sit inside the booth corner
 * keep-out.
 *
 * Both scale their content down as the window narrows and then drop fields
 * rather than clipping them, which is the same contract the rest of the chrome
 * follows.
 */
import {
  Node2D,
  textAdvance,
  type CameraView2D,
  type Gfx2D,
} from '@src/stargazer'
import { font } from '../../fonts'
import { stamp } from '../eventLog'
import { textFloor } from '../layout'
import { accentForLevel, COLORS } from '../tuning'
import type { Bounds } from '../types'
import { capBaseline, drawInverse, drawRun } from './tui'

const ZERO: Bounds = { x: 0, y: 0, width: 0, height: 0 }

/** Between two telemetry fields. */
const SEPARATOR = '·'

/**
 * The title bar.
 *
 * Keeps its own uptime rather than reading one off a seat, because in a race
 * there are two seats and only one window. Both clocks tick in `onUpdate` and
 * both reset when a run starts, so they cannot disagree.
 */
export class HeaderBarNode extends Node2D {
  #rect: Bounds = ZERO
  #title = ''
  #detail: readonly string[] = []
  #showDetail = true
  #elapsed = 0
  #accent = accentForLevel(1)

  constructor() {
    super('bo-header')
    this.renderLayer = 'dynamic'
  }

  setRect(rect: Bounds): void {
    this.#rect = rect
    this.debugBounds = { ...rect }
  }

  setTitle(title: string): void {
    this.#title = title
  }

  /** Mode and seat count, shown after the title when there is room. */
  setDetail(detail: readonly string[], show: boolean): void {
    this.#detail = detail
    this.#showDetail = show
  }

  setLevel(level: number): void {
    this.#accent = accentForLevel(level)
  }

  reset(): void {
    this.#elapsed = 0
  }

  override onUpdate(dt: number): void {
    this.#elapsed += dt
  }

  override draw(gfx: Gfx2D, camera: CameraView2D): void {
    const r = this.#rect
    if (r.width <= 0 || r.height <= 0) return
    const size = Math.max(textFloor(camera.strokeSpaceScale()), r.height * 0.5)
    const face = font(700, size)

    // Inverse video, which is how every terminal tool names itself. The bar is
    // the accent, so the title bar climbs with the level along with everything
    // else.
    drawInverse(gfx, r, this.#title, {
      fill: this.#accent,
      ink: COLORS.inkDark,
      font: face,
      align: 'left',
    })

    const pad = textAdvance('0', face)
    const right = `up ${stamp(this.#elapsed)}`
    gfx.fillText(
      right,
      r.x + r.width - pad,
      capBaseline(r.y + r.height / 2, face),
      {
        font: face,
        align: 'right',
        baseline: 'alphabetic',
        color: COLORS.inkDark,
      },
    )

    if (!this.#showDetail || this.#detail.length === 0) return
    const mid = this.#detail.join('   ')
    gfx.fillText(
      mid,
      r.x + r.width / 2,
      capBaseline(r.y + r.height / 2, face),
      {
        font: face,
        align: 'center',
        baseline: 'alphabetic',
        color: COLORS.inkDark,
      },
    )
  }
}

/**
 * The telemetry line under the input band.
 *
 * Real numbers the game already knows, rather than a legend of keys. `htop`
 * puts its function keys along the bottom and the instinct to mirror that is
 * right, but this is a touchscreen with no keyboard, and the controls are
 * already the bottom of the screen. Telemetry closes the frame without claiming
 * hardware that is not there.
 */
/** One telemetry field: a fixed name and a value that moves. */
export interface StatusField {
  label: string
  value: string
}

export class StatusBarNode extends Node2D {
  #rect: Bounds = ZERO
  #fields: readonly StatusField[] = []
  #shown = 4

  constructor() {
    super('bo-status')
    this.renderLayer = 'dynamic'
  }

  setRect(rect: Bounds): void {
    this.#rect = rect
    this.debugBounds = { ...rect }
  }

  /** Most important first, since the tail is what gets dropped. */
  setFields(fields: readonly StatusField[], shown: number): void {
    this.#fields = fields
    this.#shown = Math.max(0, shown)
  }

  /**
   * Names as whole labels, values character by character.
   *
   * A piece count that moves every lock would mint a new cached label every
   * lock if the line were joined and drawn as one string. Split, the names are
   * fixed and the digits come from an alphabet of twelve, so a run of any
   * length costs the same handful of cache entries.
   */
  override draw(gfx: Gfx2D, camera: CameraView2D): void {
    const r = this.#rect
    if (r.width <= 0 || r.height <= 0 || this.#shown === 0) return
    const size = Math.max(textFloor(camera.strokeSpaceScale()), r.height * 0.52)
    const face = font(400, size)
    const advance = textAdvance('0', face)
    if (advance <= 0) return
    const baseline = capBaseline(r.y + r.height / 2, face)

    let x = r.x
    const fields = this.#fields.slice(0, this.#shown)
    for (let i = 0; i < fields.length; i++) {
      const f = fields[i]
      gfx.fillText(f.label, x, baseline, {
        font: face,
        align: 'left',
        baseline: 'alphabetic',
        color: COLORS.ruleFaint,
      })
      x += advance * (f.label.length + 1)
      drawRun(gfx, f.value, {
        x,
        y: baseline,
        font: face,
        color: COLORS.ruleFaint,
        advance,
      })
      x += advance * (f.value.length + 1)
      if (i === fields.length - 1) break
      gfx.fillText(SEPARATOR, x, baseline, {
        font: face,
        align: 'left',
        baseline: 'alphabetic',
        color: COLORS.ruleFaint,
      })
      x += advance * (SEPARATOR.length + 1)
    }
  }
}
