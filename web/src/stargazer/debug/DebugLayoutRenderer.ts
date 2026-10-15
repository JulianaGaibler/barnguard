// Layout-box overlay for the debug HUD: outlines the measured box of every
// LayoutNode so the layout structure is visible. Pure function of the scene
// tree + camera, no controller state. Toggled separately from node outlines.

import type { CameraView2D } from '../camera/CameraView2D'
import type { Stage } from '../render/Stage'
import type { Gfx2D } from '../render/gfx/Gfx2D'
import { walkTree } from '../scene/traverse'
import { LayoutNode } from '../layout/LayoutNode'
import { viewFor, type ViewDebug } from '../scene/viewFor'

/**
 * Draw the arranged box of every visible {@link LayoutNode} in `stage`'s scene,
 * projected through the world affine to screen. Called by
 * `DebugController.drawOverlay` when the layout-outlines toggle is on. A box
 * under a layer with a space of its own is projected through that layer's
 * view.
 */
export function drawLayoutOutlines(
  gfx: Gfx2D,
  stage: Stage,
  cam: CameraView2D,
): void {
  const stroke = { color: 'rgba(45, 212, 191, 0.85)', width: 1.5 }
  const pts = new Float32Array(8)
  const debug: ViewDebug = { activeCameraFor: () => cam }

  walkTree(stage.tree.root, (node) => {
    if (!node.visible || !(node instanceof LayoutNode)) return
    const b = node.boundsOverride
    if (!b) return
    const w = node.transform.world
    const view = viewFor(node, stage, debug) ?? cam
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
      const s = view.worldToScreen(wx, wy)
      pts[i * 2] = s.x
      pts[i * 2 + 1] = s.y
    }
    gfx.strokePolyline(pts, 4, { ...stroke, closed: true })
  })
}
