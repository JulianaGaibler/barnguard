/**
 * The text on a card: a title and the body of the manifesto in two columns.
 *
 * The lines are laid out once, in design pixels at the full screen size, and
 * the node's scale takes them to every other size, so zooming a card never
 * wraps the text again. The text is tinted, so every card shares one bitmap per
 * line and size whatever its color, and `blend` takes it from white to the
 * card's color without drawing anything new.
 */
import { definePaintProps, Node2D, wrapText, type Canvas } from 'stargazer'
import { cssColor, type Rgb } from '../../game/contrast'
import type { ManifestoBlock } from '../../i18n/types'
import { CONTENT_WIDTH } from '../layout'
import { CAP_HEIGHT, textFont } from '../text'

const TITLE_SIZE = 96
const BODY_SIZE = 28
const BODY_LINE = BODY_SIZE * 1.5
const COLUMN_GAP = 64
const COLUMN_WIDTH = (CONTENT_WIDTH - COLUMN_GAP) / 2
/** The indent of a list item's text, which its number hangs in. */
const ITEM_INDENT = 42
/** Lines past this are never visible, on any card, so they are not drawn. */
const VISIBLE_HEIGHT = 1000

interface Line {
  text: string
  x: number
  y: number
  font: string
}

/** The lines of a title and body, with their positions. Exported for tests. */
export function layoutManifesto(
  title: readonly string[],
  blocks: readonly ManifestoBlock[],
): Line[] {
  const lines: Line[] = []
  const titleFont = textFont(TITLE_SIZE)
  title.forEach((text, i) => {
    lines.push({
      text,
      x: 0,
      y: TITLE_SIZE * CAP_HEIGHT + i * TITLE_SIZE,
      font: titleFont,
    })
  })

  const bodyFont = textFont(BODY_SIZE)
  const bodyX = COLUMN_WIDTH + COLUMN_GAP
  let y = BODY_SIZE * CAP_HEIGHT
  let number = 0
  for (const block of blocks) {
    const item = block.kind === 'item'
    number = item ? number + 1 : 0
    const indent = item ? ITEM_INDENT : 0
    const wrapped = wrapText(block.text, bodyFont, COLUMN_WIDTH - indent, 99)
    wrapped.forEach((text, i) => {
      if (y > VISIBLE_HEIGHT) return
      if (item && i === 0) {
        lines.push({ text: `${number}.`, x: bodyX, y, font: bodyFont })
      }
      lines.push({ text, x: bodyX + indent, y, font: bodyFont })
      y += BODY_LINE
    })
  }
  return lines
}

export class ManifestoNode extends Node2D {
  /** Whether the text is in the card's color (1) or white (0). */
  declare blend: number
  /**
   * The scale the text is drawn at, while it warms {@link warmScales}, or 0
   * while it warms nothing.
   */
  declare warmFrom: number
  /**
   * The scales a zoom of the text may end at. Their rasters are made ahead, so
   * a zoom draws from a sharp one from its first frame and does not pop when it
   * lands.
   */
  warmScales: readonly number[] = []
  readonly #color: Rgb
  readonly #lines: Line[]

  constructor(
    title: readonly string[],
    blocks: readonly ManifestoBlock[],
    color: Rgb,
  ) {
    super('manifesto')
    definePaintProps(this, { blend: 0, warmFrom: 0 })
    this.#color = color
    this.#lines = layoutManifesto(title, blocks)
    this.boundsOverride = {
      x: 0,
      y: 0,
      width: CONTENT_WIDTH,
      height: VISIBLE_HEIGHT,
    }
  }

  override paint(canvas: Canvas): void {
    const t = Math.min(Math.max(this.blend, 0), 1)
    const [r, g, b] = this.#color
    const color = cssColor([
      Math.round(255 + (r - 255) * t),
      Math.round(255 + (g - 255) * t),
      Math.round(255 + (b - 255) * t),
    ])
    if (this.warmFrom > 0) {
      for (const scale of this.warmScales)
        this.#warm(canvas, scale / this.warmFrom)
    }
    for (const line of this.#lines) {
      canvas.fillText(line.text, line.x, line.y, {
        font: line.font,
        color,
        baseline: 'alphabetic',
        tint: true,
      })
    }
  }

  #warm(canvas: Canvas, k: number): void {
    canvas.save()
    canvas.scale(k, k)
    for (const line of this.#lines) {
      canvas.warmText(line.text, {
        font: line.font,
        baseline: 'alphabetic',
        tint: true,
      })
    }
    canvas.restore()
  }
}
