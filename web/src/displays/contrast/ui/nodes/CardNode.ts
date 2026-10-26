/**
 * A card's shape. It starts as an outline on the screen's own color, so nothing
 * about the pair shows, and takes its fill as `reveal` goes 0 to 1. A fill too
 * close to the screen gets a faint edge once it shows, which goes again as the
 * card fills the screen, where it has no screen to stand off from.
 */
import { definePaintProps, Node2D, type Canvas } from 'stargazer'
import { OUTLINE_COLOR } from '../../game/outline'
import { PALETTE } from '../../theme'

const OUTLINE = { color: PALETTE.white, width: { screen: 2 } }
const EDGE = { color: OUTLINE_COLOR, width: { screen: 2 } }

export class CardNode extends Node2D {
  declare width: number
  declare height: number
  declare radius: number
  declare fill: string
  declare reveal: number
  /** Whether the fill needs an edge to stand off the screen. */
  declare edge: boolean
  /** 0 to 1: how far the card has zoomed to fill the screen. */
  declare zoom: number

  constructor(fill: string, edge: boolean) {
    super('card')
    definePaintProps(this, {
      width: 0,
      height: 0,
      radius: 0,
      fill,
      reveal: 0,
      edge,
      zoom: 0,
    })
  }

  /** Sizes the card, which also sets the box it takes taps in. */
  setShape(width: number, height: number, radius: number): void {
    this.width = width
    this.height = height
    this.radius = radius
    this.boundsOverride = { x: 0, y: 0, width, height }
  }

  override paint(canvas: Canvas): void {
    const { width: w, height: h, radius, reveal } = this
    if (w <= 0 || h <= 0) return
    if (reveal < 1) canvas.fillRoundRect(0, 0, w, h, radius, PALETTE.ink)
    if (reveal > 0) {
      canvas.setAlpha(reveal)
      canvas.fillRoundRect(0, 0, w, h, radius, this.fill)
      const edge = reveal * (1 - this.zoom)
      if (this.edge && edge > 0.001) {
        canvas.setAlpha(edge)
        canvas.strokeRoundRect(0, 0, w, h, radius, EDGE)
      }
      canvas.setAlpha(1)
    }
    if (reveal < 1) {
      canvas.setAlpha(1 - reveal)
      canvas.strokeRoundRect(0, 0, w, h, radius, OUTLINE)
      canvas.setAlpha(1)
    }
  }
}
