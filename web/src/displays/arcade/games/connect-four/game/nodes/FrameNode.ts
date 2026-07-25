import { SceneNode, type Camera, type Gfx2D } from '@src/stargazer'
import type { BoardLayout } from '../layout'
import { FRAME } from '../tuning'

/**
 * Sketch-like registration marks at the four board corners: a right-angle
 * bracket per corner whose arms run along the panel edges and overshoot past
 * the corner, for a technical-drawing feel. Stroke width is in CSS pixels
 * (constant on screen as the camera zooms). The vertical technical labels are
 * separate TextNodes owned by the session.
 */
export class FrameNode extends SceneNode {
  readonly #layout: BoardLayout

  constructor(layout: BoardLayout) {
    super('cf-frame')
    this.#layout = layout
    this.renderLayer = 'dynamic'
  }

  override draw(gfx: Gfx2D, camera: Camera): void {
    const layout = this.#layout
    const x0 = layout.panelX
    const y0 = layout.panelY
    const x1 = layout.panelX + layout.panelW
    const y1 = layout.panelY + layout.panelH
    const arm = FRAME.arm
    const over = FRAME.overshoot
    const style = {
      color: FRAME.color,
      width: FRAME.width * camera.strokeSpaceScale(),
      cap: 'round' as const,
    }

    // Each corner: one horizontal + one vertical segment, extending `over` past
    // the corner and `arm` inward along the edge.
    // Top-left.
    gfx.strokeLine(x0 - over, y0, x0 + arm, y0, style)
    gfx.strokeLine(x0, y0 - over, x0, y0 + arm, style)
    // Top-right.
    gfx.strokeLine(x1 + over, y0, x1 - arm, y0, style)
    gfx.strokeLine(x1, y0 - over, x1, y0 + arm, style)
    // Bottom-left.
    gfx.strokeLine(x0 - over, y1, x0 + arm, y1, style)
    gfx.strokeLine(x0, y1 + over, x0, y1 - arm, style)
    // Bottom-right.
    gfx.strokeLine(x1 + over, y1, x1 - arm, y1, style)
    gfx.strokeLine(x1, y1 + over, x1, y1 - arm, style)
  }
}
