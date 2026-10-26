/**
 * The title and the premise of the splash, in a column at the left. The column
 * is measured here and the scene places the Play button under it from the same
 * numbers, so the two cannot drift apart.
 */
import {
  definePaintProps,
  Node2D,
  textWidth,
  wrapText,
  type Canvas,
} from 'stargazer'
import { PALETTE } from '../../theme'
import type { Layout } from '../layout'
import { CAP_HEIGHT, headlineFont, textFont } from '../text'

const TITLE_SIZE = 146
const TITLE_LINE = TITLE_SIZE * 0.85
const PREMISE_SIZE = 40
const PREMISE_LINE = PREMISE_SIZE * 1.07
const TITLE_GAP = 85
const PREMISE_GAP = 66
const BUTTON_SIZE = 80
const BUTTON_PAD_X = 64
const BUTTON_PAD_Y = 40

export interface SplashBlock {
  titleLines: string[]
  premiseLines: string[]
  /** Top of the title's first line, and of the premise. */
  titleTop: number
  premiseTop: number
  button: { x: number; y: number; width: number; height: number }
}

/** Measures the column for `layout`. */
export function measureSplash(
  layout: Layout,
  title: string,
  premise: string,
  play: string,
): SplashBlock {
  const { x, width, centerY } = layout.splash.column
  const titleLines = wrapText(title, headlineFont(TITLE_SIZE), width, 4)
  const premiseLines = wrapText(premise, textFont(PREMISE_SIZE), width, 6)
  const titleHeight = titleLines.length * TITLE_LINE
  const premiseHeight = premiseLines.length * PREMISE_LINE
  const buttonHeight = BUTTON_SIZE * 1.05 + BUTTON_PAD_Y * 2
  const total =
    titleHeight + TITLE_GAP + premiseHeight + PREMISE_GAP + buttonHeight
  const top = centerY - total / 2
  const titleTop = top
  const premiseTop = titleTop + titleHeight + TITLE_GAP
  return {
    titleLines,
    premiseLines,
    titleTop,
    premiseTop,
    button: {
      x,
      y: premiseTop + premiseHeight + PREMISE_GAP,
      width: textWidth(play, headlineFont(BUTTON_SIZE)) + BUTTON_PAD_X * 2,
      height: buttonHeight,
    },
  }
}

export const PLAY_LOOK = { size: BUTTON_SIZE }

export class SplashTextNode extends Node2D {
  declare block: SplashBlock
  declare x0: number

  constructor(layout: Layout, title: string, premise: string, play: string) {
    super('splash-text')
    const block = measureSplash(layout, title, premise, play)
    definePaintProps(this, { block, x0: layout.splash.column.x })
    this.boundsOverride = {
      x: 0,
      y: 0,
      width: layout.width,
      height: layout.height,
    }
  }

  /** Measures again for a new layout. */
  setLayout(
    layout: Layout,
    title: string,
    premise: string,
    play: string,
  ): SplashBlock {
    this.x0 = layout.splash.column.x
    this.block = measureSplash(layout, title, premise, play)
    return this.block
  }

  override paint(canvas: Canvas): void {
    const { block, x0 } = this
    block.titleLines.forEach((line, i) => {
      canvas.fillText(
        line,
        x0,
        block.titleTop + i * TITLE_LINE + TITLE_SIZE * CAP_HEIGHT,
        {
          font: headlineFont(TITLE_SIZE),
          color: PALETTE.white,
          baseline: 'alphabetic',
        },
      )
    })
    block.premiseLines.forEach((line, i) => {
      canvas.fillText(
        line,
        x0,
        block.premiseTop + i * PREMISE_LINE + PREMISE_SIZE * CAP_HEIGHT,
        {
          font: textFont(PREMISE_SIZE),
          color: PALETTE.white,
          baseline: 'alphabetic',
        },
      )
    })
  }
}
