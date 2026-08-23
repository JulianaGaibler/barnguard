/**
 * The live time bonus: a depleting horizontal meter with the current value
 * beside it, in the same monochrome-plus-accent language as `ProgressNode`.
 * Nothing else on screen shows that the bonus decays, so a player has no way to
 * know the one score component they can still act on is running out.
 *
 * A depleting bar could be read as a countdown to losing, so the meter states
 * points rather than time: the value carries a `+`, and the caption names the
 * bonus. An empty meter costs the player nothing beyond the bonus itself.
 *
 * The value comes from a supplier rather than a setter, so the meter reads the
 * owning session's own clock every frame and cannot drift from what a clear
 * will actually pay.
 */
import { Node2D, type Gfx2D } from '@src/stargazer'
import { COLORS, PROGRESS_ACCENT, SCORING } from '../tuning'
import { font } from '../../fonts'

const TRACK_FILL = 'rgba(39, 39, 39, 0.14)'
const TRACK_H = 12
const CAPTION_GAP = 9

/**
 * Round the value down to a whole second's worth of decay. The exact bonus
 * changes about five times a second, which is unreadable churn on a HUD, so the
 * digits step once a second while the bar carries the continuous signal.
 * Rounding down keeps the readout from promising more than a clear will pay.
 */
function quantize(value: number): number {
  const step = SCORING.timePenaltyPerSec
  return Math.floor(value / step) * step
}

export interface TimeBonusOptions {
  /** Points the bonus would pay if the level cleared this frame. */
  value: () => number
  /** Small caption above the meter. */
  label: string
  /** Track width in world units. */
  width: number
  /** Accent for the remaining fill. */
  color?: string
}

export class TimeBonusNode extends Node2D {
  readonly #value: () => number
  readonly #label: string
  readonly #color: string
  #width: number

  constructor(opts: TimeBonusOptions) {
    super('jb-time-bonus')
    this.renderLayer = 'dynamic'
    this.#value = opts.value
    this.#label = opts.label
    this.#color = opts.color ?? PROGRESS_ACCENT
    this.#width = opts.width
  }

  setWidth(width: number): void {
    this.#width = width
  }

  override draw(gfx: Gfx2D): void {
    const w = this.#width
    const value = this.#value()
    const frac = Math.max(0, Math.min(1, value / SCORING.timeBonusBase))
    const trackY = -TRACK_H / 2

    gfx.fillRect(-w / 2, trackY, w, TRACK_H, COLORS.white)
    gfx.fillRect(-w / 2, trackY, w, TRACK_H, TRACK_FILL)
    gfx.fillRect(-w / 2, trackY, w * frac, TRACK_H, this.#color)
    gfx.strokeRoundRect(-w / 2, trackY, w, TRACK_H, 0, {
      color: COLORS.ink,
      width: 2,
    })

    // The label and the value bracket the track, so a shrinking value does not
    // shift the label.
    const captionY = trackY - CAPTION_GAP
    gfx.fillText(this.#label, -w / 2, captionY, {
      font: font(700, 13.6),
      align: 'left',
      baseline: 'bottom',
      color: COLORS.ink,
    })
    gfx.fillText(`+${quantize(value)}`, w / 2, captionY, {
      font: font(800, 20.8),
      align: 'right',
      baseline: 'bottom',
      color: value > 0 ? COLORS.ink : COLORS.slotEmpty,
    })
  }
}
