/**
 * What the scale says once a round is answered: the verdict at the left, the
 * YOUR PICK line over the answer the player chose, unless the clock ran out,
 * and the ACTUAL bubble under the right one. The scene fades the whole node in
 * and out.
 */
import { definePaintProps, Node2D, type Canvas } from 'stargazer'
import type { Level } from '../../game/contrast'
import { PALETTE } from '../../theme'
import type { Layout } from '../layout'
import { fillTracked, textFont, trackedWidth, CAP_HEIGHT } from '../text'
import { LEVEL_COLORS } from './thumbs'

export type Verdict = 'correct' | 'incorrect' | 'timeout'

const LABEL_SIZE = 16
const TRACKING = 1.6
const CHIP_HEIGHT = 40
const CHIP_PAD = 8
const POINTER_WIDTH = 12
const POINTER_HEIGHT = 8
const CHIP_GAP = 12
const PICK_GAP = 9

export interface Answer {
  verdict: Verdict
  /** The text of the verdict. */
  text: string
  actual: Level
  /** The level the player chose, or null when the clock ran out. */
  pick: Level | null
}

export class AnswerNode extends Node2D {
  declare layout: Layout
  declare answer: Answer | null
  readonly #actual: string
  readonly #pick: string

  constructor(layout: Layout, actual: string, pick: string) {
    super('answer')
    definePaintProps(this, { layout, answer: null })
    this.#actual = actual
    this.#pick = pick
    this.setLayout(layout)
  }

  setLayout(layout: Layout): void {
    this.layout = layout
    this.boundsOverride = {
      x: 0,
      y: layout.rowY - 120,
      width: layout.width,
      height: 220,
    }
  }

  override paint(canvas: Canvas): void {
    const answer = this.answer
    if (!answer) return
    const { layout } = this
    canvas.fillText(answer.text, layout.labels.result.x, layout.rowY, {
      font: textFont(40),
      color: PALETTE.white,
      baseline: 'middle',
    })

    const font = textFont(LABEL_SIZE)
    const top = layout.scale[0]!.y
    const bottom = top + layout.scale[0]!.height

    // The player's pick is the line over the scale and the right answer is the
    // bubble under it, pointing up at it.
    if (answer.pick !== null) {
      const pick = layout.scale[answer.pick - 1]!
      const pickColor = LEVEL_COLORS[answer.pick]
      const lineY = top - PICK_GAP - 2
      canvas.fillRect(pick.x + 1, lineY, pick.width - 2, 2, pickColor)
      fillTracked(
        canvas,
        this.#pick,
        pick.x + pick.width / 2,
        lineY - 8 - 12 + (LABEL_SIZE * CAP_HEIGHT) / 2,
        { font, color: pickColor, tracking: TRACKING },
        'center',
      )
    }

    const actual = layout.scale[answer.actual - 1]!
    const actualColor = LEVEL_COLORS[answer.actual]
    const actualX = actual.x + actual.width / 2
    const chipWidth = trackedWidth(this.#actual, font, TRACKING) + CHIP_PAD * 2
    const tipY = bottom + CHIP_GAP - 4
    const chipY = tipY + POINTER_HEIGHT
    canvas.fillRoundRect(
      actualX - chipWidth / 2,
      chipY,
      chipWidth,
      CHIP_HEIGHT,
      CHIP_HEIGHT / 2,
      actualColor,
    )
    canvas.fillConvexPoly(
      [
        actualX - POINTER_WIDTH / 2,
        chipY + 1,
        actualX + POINTER_WIDTH / 2,
        chipY + 1,
        actualX,
        tipY,
      ],
      3,
      actualColor,
    )
    fillTracked(
      canvas,
      this.#actual,
      actualX,
      chipY + CHIP_HEIGHT / 2 + (LABEL_SIZE * CAP_HEIGHT) / 2,
      { font, color: PALETTE.ink, tracking: TRACKING },
      'center',
    )
  }
}
