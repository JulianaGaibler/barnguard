// Layout-box overlay for the debug HUD: outlines the measured box of every
// LayoutNode so the layout structure is visible. Pure function of the scene
// tree + camera, no controller state. Toggled separately from node outlines.

import type { Camera } from '../camera/Camera'
import type { Stage } from '../render/Stage'
import type { Gfx2D } from '../render/gfx/Gfx2D'
import { walkTree } from '../scene/traverse'
import { LayoutNode } from '../layout/LayoutNode'

/**
 * Draw the arranged box of every visible {@link LayoutNode} in `stage`'s scene,
 * projected through the world affine to screen. Called by
 * `DebugController.drawOverlay` when the layout-outlines toggle is on.
 */
export function drawLayoutOutlines(
  gfx: Gfx2D,
  stage: Stage,
  cam: Camera,
): void {
  const stroke = { color: 'rgba(45, 212, 191, 0.85)', width: 1.5 }
  const pts = new Float32Array(8)

  walkTree(stage.scene.root, (node) => {
    if (!node.visible || !(node instanceof LayoutNode)) return
    const b = node.debugBounds
    if (!b) return
    const w = node.transform.world
    const corners: Array<[number, number]> = [
      [b.x, b.y],
      [b.x + b.width, b.y],
      [b.x + b.width, b.y + b.height],
      [b.x, b.y + b.height],
    ]
    for (let i = 0; i < 4; i++) {
      const lx = corners[i][0]
      const ly = corners[i][1]
      const wx = w.a * lx + w.c * ly + w.e
      const wy = w.b * lx + w.d * ly + w.f
      const s = cam.worldToScreen(wx, wy)
      pts[i * 2] = s.x
      pts[i * 2 + 1] = s.y
    }
    gfx.strokePolyline(pts, 4, { ...stroke, closed: true })
  })
}
