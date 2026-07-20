/**
 * A live count drawn in a team's flick strip: how many of the team's orbs are
 * currently resting in its scoring band. Extends the queue indicator (which
 * shows orbs LEFT) with a scoring-progress number, using the engine's
 * `Gfx2D.fillText`. Recomputed every frame from a caller-supplied `count`
 * closure so it tracks orbs rolling in and out of the band.
 *
 * The node is positioned at its anchor via its transform and draws the number
 * centered on the origin; a world-unit font keeps it in scale with the field.
 */
import { SceneNode, type Gfx2D } from '@src/stargazer'
import { SCORE_TEXT } from '../tuning'

export class ScoringCountNode extends SceneNode {
  readonly #count: () => number
  readonly #color: string
  readonly #font = `${SCORE_TEXT.fontWeight} ${SCORE_TEXT.fontPx}px ${SCORE_TEXT.fontFamily}`

  constructor(
    /** Returns the current count to display (evaluated each frame). */
    count: () => number,
    x: number,
    y: number,
    color: string,
  ) {
    super('orbo-score-count')
    this.#count = count
    this.#color = color
    this.renderLayer = 'dynamic'
    this.transform.x = x
    this.transform.y = y
  }

  override draw(gfx: Gfx2D): void {
    gfx.fillText(String(this.#count()), 0, 0, {
      font: this.#font,
      align: 'center',
      baseline: 'middle',
      color: this.#color,
    })
  }
}
