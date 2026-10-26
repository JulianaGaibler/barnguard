/** One of the example cards on the splash: a color pair and the thumbs it rates. */
import { definePaintProps, Node2D, type Canvas } from 'stargazer'
import type { Level } from '../../game/contrast'
import { OUTLINE_COLOR } from '../../game/outline'
import { drawThumbs, thumbsWidth } from './thumbs'

/** The corner radius as a share of the height, a pill that is not quite round. */
const RADIUS_OF_HEIGHT = 0.4
const PADDING = 56
const THUMB = 88
const EDGE = { color: OUTLINE_COLOR, width: { screen: 1 } }

export class SplashCardNode extends Node2D {
  declare width: number
  declare height: number
  declare level: Level
  declare fill: string
  /** The color of the thumbs, which is the text color of the pair. */
  declare ink: string
  declare edge: boolean

  constructor(level: Level, fill: string, ink: string, edge: boolean) {
    super('splash-card')
    definePaintProps(this, { width: 0, height: 0, level, fill, ink, edge })
  }

  setSize(width: number, height: number): void {
    this.width = width
    this.height = height
    this.boundsOverride = { x: 0, y: 0, width, height }
  }

  override paint(canvas: Canvas): void {
    const { width: w, height: h } = this
    if (w <= 0) return
    const radius = h * RADIUS_OF_HEIGHT
    if (this.edge) {
      canvas.fillAndStrokeRoundRect(0, 0, w, h, radius, this.fill, EDGE)
    } else {
      canvas.fillRoundRect(0, 0, w, h, radius, this.fill)
    }
    const width = thumbsWidth(this.level, THUMB)
    drawThumbs(
      canvas,
      this.level,
      PADDING + width / 2,
      h / 2,
      THUMB,
      this.ink,
      this.ink,
    )
  }
}
