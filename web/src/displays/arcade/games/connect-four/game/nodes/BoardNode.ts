import { SceneNode, type Gfx2D } from '@src/stargazer'
import { COLS, ROWS } from '../board'
import { cellCenter, type BoardLayout } from '../layout'
import { BOARD } from '../tuning'

/**
 * The Connect Four board: a rounded panel with 42 holes cut out, rasterized
 * once to an OffscreenCanvas and blitted (the caching approach Orbo's PanelNode
 * uses). Discs render on a layer behind this node, so the holes show them and a
 * falling disc reads through each hole as it passes. The board group fades in
 * and out on match start / return, so this node just draws the bitmap.
 */
export class BoardNode extends SceneNode {
  readonly #layout: BoardLayout
  #bitmap: OffscreenCanvas | null = null

  constructor(layout: BoardLayout) {
    super('cf-board')
    this.#layout = layout
    this.renderLayer = 'dynamic'
  }

  #ensureBitmap(): OffscreenCanvas | null {
    if (this.#bitmap) return this.#bitmap
    if (typeof OffscreenCanvas === 'undefined') return null
    const l = this.#layout
    const canvas = new OffscreenCanvas(Math.ceil(l.panelW), Math.ceil(l.panelH))
    const ctx = canvas.getContext('2d')
    if (!ctx) return null
    ctx.fillStyle = BOARD.bg
    ctx.beginPath()
    ctx.roundRect(0, 0, canvas.width, canvas.height, BOARD.radius)
    ctx.fill()
    // Punch the 42 holes (coords relative to the panel's top-left).
    ctx.globalCompositeOperation = 'destination-out'
    const holeR = l.cell * BOARD.holeRadiusFrac
    for (let row = 0; row < ROWS; row++) {
      for (let col = 0; col < COLS; col++) {
        const c = cellCenter(l, col, row)
        ctx.beginPath()
        ctx.arc(c.x - l.panelX, c.y - l.panelY, holeR, 0, Math.PI * 2)
        ctx.fill()
      }
    }
    ctx.globalCompositeOperation = 'source-over'
    this.#bitmap = canvas
    return this.#bitmap
  }

  override draw(gfx: Gfx2D): void {
    const l = this.#layout
    const bmp = this.#ensureBitmap()
    if (bmp) gfx.drawImage(bmp, l.panelX, l.panelY, l.panelW, l.panelH)
  }
}
