/**
 * A live count drawn in a team's flick strip: how many of the team's orbs are
 * currently resting in its scoring band. Extends the queue indicator (which
 * shows orbs LEFT) with a scoring-progress number, using the engine's
 * `Gfx2D.fillText`. Recomputed every frame from a caller-supplied `count`
 * closure so it tracks orbs rolling in and out of the band, and paints again
 * only when the number changes.
 *
 * The node is positioned at its anchor via its transform and draws the number
 * centered on the origin. A world-unit font keeps it in scale with the field.
 */
import { Node2D, definePaintProps, type Canvas } from 'stargazer'
import { fontFor } from '@src/core/theme'
import { SCORE_TEXT } from '../tuning'
import { ORBO_FONTS } from '../../fonts'

export class ScoringCountNode extends Node2D {
  readonly #count: () => number
  declare count: number
  readonly #color: string
  readonly #font = fontFor(
    ORBO_FONTS,
    'heading',
    SCORE_TEXT.fontWeight,
    SCORE_TEXT.fontPx,
  )

  constructor(
    /** Returns the current count to display (evaluated each frame). */
    count: () => number,
    x: number,
    y: number,
    color: string,
  ) {
    super('orbo-score-count')
    this.#count = count
    definePaintProps(this, { count: count() })
    this.#color = color
    this.transform.x = x
    this.transform.y = y
  }

  override onUpdate(): void {
    this.count = this.#count()
  }

  override paint(gfx: Canvas): void {
    gfx.fillText(String(this.count), 0, 0, {
      font: this.#font,
      align: 'center',
      baseline: 'middle',
      color: this.#color,
    })
  }
}
