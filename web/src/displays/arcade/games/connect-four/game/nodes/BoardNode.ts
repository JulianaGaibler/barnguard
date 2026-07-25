import { SceneNode, type Camera, type Gfx2D } from '@src/stargazer'
import { COLS, ROWS } from '../board'
import { cellCenter, type BoardLayout } from '../layout'
import { BOARD } from '../tuning'

/**
 * The Connect Four board: a light translucent panel with a single rounded
 * corner (top-right), a subtly darker "well" per slot, and a faint X behind
 * each slot. Drawn straight from primitives — the panel as one rounded-rect SDF
 * quad, wells as circles, X's as line pairs — so there's no bitmap to bake and
 * no flip quirk, and the whole node fades cleanly with `transform.alpha` on
 * reveal/return. Discs render on a layer IN FRONT, so a dropped chip sits over
 * its well (a ring of well shows around it) and covers the slot's X.
 */
export class BoardNode extends SceneNode {
  readonly #layout: BoardLayout

  constructor(layout: BoardLayout) {
    super('cf-board')
    this.#layout = layout
    this.renderLayer = 'dynamic'
  }

  override draw(gfx: Gfx2D, camera: Camera): void {
    const layout = this.#layout
    // Panel: only the top-right corner rounded (radii are [tl, tr, br, bl]).
    gfx.fillRoundRect(
      layout.panelX,
      layout.panelY,
      layout.panelW,
      layout.panelH,
      [0, BOARD.cornerRadius, 0, 0],
      BOARD.bg,
    )

    const wellR = layout.cell * BOARD.wellRadiusFrac
    const arm = layout.cell * BOARD.xArmFrac
    const xWidth = BOARD.xWidth * camera.strokeSpaceScale()
    for (let row = 0; row < ROWS; row++) {
      for (let col = 0; col < COLS; col++) {
        const center = cellCenter(layout, col, row)
        gfx.fillCircle(center.x, center.y, wellR, BOARD.wellFill)
        const style = {
          color: BOARD.xColor,
          width: xWidth,
          cap: 'round' as const,
        }
        gfx.strokeLine(
          center.x - arm,
          center.y - arm,
          center.x + arm,
          center.y + arm,
          style,
        )
        gfx.strokeLine(
          center.x - arm,
          center.y + arm,
          center.x + arm,
          center.y - arm,
          style,
        )
      }
    }
  }
}
