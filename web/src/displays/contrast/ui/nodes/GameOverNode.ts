/**
 * The head of the game over screen: the score as one huge numeral, "Game over"
 * as two outlined words behind it, and the best score or the news of a new
 * one.
 *
 * The engine draws filled text only, so the outlined words are drawn once into
 * a bitmap with a canvas 2D stroke and the engine draws that.
 */
import { definePaintProps, Node2D, type Canvas } from 'stargazer'
import { PALETTE } from '../../theme'
import type { Layout } from '../layout'
import { CAP_HEIGHT, headlineFont, textFont, trackedWidth } from '../text'

const NUMERAL_SIZE = 327.6
const WORD_SIZE = 175.2
/** Half the space between the two words. */
const WORD_GAP = 37.2
const OUTLINE = 'rgba(255, 255, 255, 0.2)'
/** The bitmaps are drawn at this multiple, so they stay sharp on a dense screen. */
const BITMAP_SCALE = 2

interface Outlined {
  image: HTMLCanvasElement
  width: number
  height: number
}

/** `text` as a stroked outline in the headline face, `size` design pixels high. */
function outlined(text: string, size: number): Outlined | null {
  if (typeof document === 'undefined') return null
  const image = document.createElement('canvas')
  const ctx = image.getContext('2d')
  if (!ctx) return null
  const font = `600 ${size * BITMAP_SCALE}px "Mozilla Headline Condensed"`
  ctx.font = font
  const pad = 4 * BITMAP_SCALE
  const textWidth = Math.ceil(ctx.measureText(text).width)
  image.width = textWidth + pad * 2
  image.height = Math.ceil(size * BITMAP_SCALE * 1.1) + pad * 2
  // Resizing resets the context, so the style is set again.
  ctx.font = font
  ctx.textBaseline = 'alphabetic'
  // The face's glyphs are built from overlapping contours, and a plain stroke
  // traces the overlaps too. Stroke twice as wide, then cut the filled glyph
  // out, which leaves only the outer edge, as wide as the line wanted.
  const baseline = pad + size * BITMAP_SCALE * CAP_HEIGHT
  ctx.lineWidth = 4 * BITMAP_SCALE
  ctx.lineJoin = 'round'
  ctx.strokeStyle = OUTLINE
  ctx.strokeText(text, pad, baseline)
  ctx.globalCompositeOperation = 'destination-out'
  ctx.fillStyle = '#000'
  ctx.fillText(text, pad, baseline)
  return {
    image,
    width: image.width / BITMAP_SCALE,
    height: image.height / BITMAP_SCALE,
  }
}

export class GameOverNode extends Node2D {
  declare layout: Layout
  declare score: number
  declare best: string
  readonly #words: readonly [Outlined | null, Outlined | null]

  constructor(layout: Layout, words: readonly [string, string]) {
    super('game-over-head')
    definePaintProps(this, { layout, score: 0, best: '' })
    this.#words = [outlined(words[0], WORD_SIZE), outlined(words[1], WORD_SIZE)]
    this.setLayout(layout)
  }

  setLayout(layout: Layout): void {
    this.layout = layout
    this.boundsOverride = {
      x: 0,
      y: 0,
      width: layout.width,
      height: layout.height / 2 + 60,
    }
  }

  override paint(canvas: Canvas): void {
    const { numeral, best } = this.layout.gameOver
    const centerX = this.layout.width / 2
    const [game, over] = this.#words
    const wordTop = numeral.y - (WORD_SIZE * CAP_HEIGHT) / 2 - 4
    if (game) {
      canvas.drawImage(
        game.image,
        centerX - WORD_GAP - game.width,
        wordTop,
        game.width,
        game.height,
      )
    }
    if (over) {
      canvas.drawImage(
        over.image,
        centerX + WORD_GAP,
        wordTop,
        over.width,
        over.height,
      )
    }
    canvas.fillText(
      String(this.score),
      numeral.x,
      numeral.y + (NUMERAL_SIZE * CAP_HEIGHT) / 2,
      {
        font: headlineFont(NUMERAL_SIZE),
        color: PALETTE.white,
        align: 'center',
        baseline: 'alphabetic',
      },
    )
    // Left of the label starts past the numeral, whatever its width.
    const numeralRight =
      numeral.x +
      trackedWidth(String(this.score), headlineFont(NUMERAL_SIZE), 0) / 2
    canvas.fillText(
      this.best,
      Math.max(best.x - 90, numeralRight + 24),
      best.y,
      {
        font: textFont(24),
        color: PALETTE.white,
        align: 'left',
        baseline: 'middle',
      },
    )
  }
}
