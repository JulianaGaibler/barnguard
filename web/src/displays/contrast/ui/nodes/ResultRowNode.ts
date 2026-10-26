/**
 * The line under a card in the strip: the verdict, and the pick in a pill. A
 * missed card shows the pick, then "but was", then the right answer.
 */
import { definePaintProps, Node2D, type Canvas } from 'stargazer'
import type { Level } from '../../game/contrast'
import { OUTLINE_COLOR } from '../../game/outline'
import { PALETTE } from '../../theme'
import { STRIP_WIDTH } from '../layout'
import { textFont } from '../text'
import { drawThumbs, LEVEL_COLORS, thumbsWidth } from './thumbs'

const THUMB = 24
const PAD = 16
const PILL_HEIGHT = THUMB + PAD * 2
const GAP = 8
const EDGE = { color: OUTLINE_COLOR, width: { screen: 1 } }

export interface ResultRow {
  /** The verdict in words. */
  text: string
  /** The level the player chose, or null when the clock ran out. */
  pick: Level | null
  actual: Level
  correct: boolean
}

export class ResultRowNode extends Node2D {
  declare row: ResultRow
  readonly #butWas: readonly [string, string]

  constructor(row: ResultRow, butWas: readonly [string, string]) {
    super('result-row')
    definePaintProps(this, { row })
    this.#butWas = butWas
    this.boundsOverride = {
      x: 0,
      y: 0,
      width: STRIP_WIDTH,
      height: PILL_HEIGHT,
    }
  }

  override paint(canvas: Canvas): void {
    const { row } = this
    const cy = PILL_HEIGHT / 2
    canvas.fillText(row.text, 0, cy, {
      font: textFont(24),
      color: PALETTE.white,
      baseline: 'middle',
    })

    // Laid out from the right edge, so the last thing in the row lines up with the card.
    const shown: Level[] =
      row.pick !== null && !row.correct ? [row.pick, row.actual] : [row.actual]
    const pills = shown.map((level) => thumbsWidth(level, THUMB) + PAD * 2)
    const joiner = shown.length > 1
    const joinerWidth = joiner ? 44 : 0
    const total =
      pills.reduce((sum, w) => sum + w, 0) +
      (joiner ? joinerWidth + GAP * 2 : 0)
    let x = STRIP_WIDTH - total
    shown.forEach((level, i) => {
      const w = pills[i]!
      canvas.fillAndStrokeRoundRect(
        x,
        0,
        w,
        PILL_HEIGHT,
        PILL_HEIGHT / 2,
        PALETTE.ink,
        EDGE,
      )
      drawThumbs(
        canvas,
        level,
        x + w / 2,
        cy,
        THUMB,
        LEVEL_COLORS[level],
        LEVEL_COLORS[level],
      )
      x += w
      if (joiner && i === 0) {
        const font = textFont(12)
        const style = {
          font,
          color: PALETTE.white,
          align: 'center' as const,
          baseline: 'middle' as const,
        }
        canvas.fillText(
          this.#butWas[0].toUpperCase(),
          x + GAP + joinerWidth / 2,
          cy - 9,
          style,
        )
        canvas.fillText(
          this.#butWas[1].toUpperCase(),
          x + GAP + joinerWidth / 2,
          cy + 9,
          style,
        )
        x += joinerWidth + GAP * 2
      }
    })
  }
}
