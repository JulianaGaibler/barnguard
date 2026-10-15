// Per-node pivot cross + OBB outline overlay for the debug HUD. Pure function
// of the scene tree + camera, no controller state.

import type { CameraView2D } from '../camera/CameraView2D'
import type { Stage } from '../render/Stage'
import type { Gfx2D } from '../render/gfx/Gfx2D'
import type { Node2D } from '../scene/Node2D'
import { isEffectivelyVisible, walkTree } from '../scene/traverse'
import { viewFor, type ViewDebug } from '../scene/viewFor'

/**
 * Draw a pivot cross + OBB outline for every visible, `debugVisible` node in
 * `stage`'s scene. Called by `DebugController.drawOverlay` when the outlines
 * toggle is on. `cam` places the nodes the stage's camera places, and a node
 * under a layer with a space of its own is placed by that layer's view.
 */
export function drawNodeOutlines(
  gfx: Gfx2D,
  stage: Stage,
  cam: CameraView2D,
): void {
  const strokeStyle = { color: 'rgba(96, 165, 250, 0.6)', width: 1 }
  const rectPts = new Float32Array(8)
  const debug: ViewDebug = { activeCameraFor: () => cam }

  walkTree(stage.tree.root, (n) => {
    if (n.kind !== '2d') return
    const node = n as Node2D
    if (!node.debugVisible || !isEffectivelyVisible(node)) return
    const w = node.transform.world
    const view = viewFor(node, stage, debug) ?? cam
    // Pivot cross at node origin.
    const px = w.e
    const py = w.f
    const screenOrigin = view.worldToScreen(px, py)
    const cross = 4
    gfx.strokeLine(
      screenOrigin.x - cross,
      screenOrigin.y,
      screenOrigin.x + cross,
      screenOrigin.y,
      strokeStyle,
    )
    gfx.strokeLine(
      screenOrigin.x,
      screenOrigin.y - cross,
      screenOrigin.x,
      screenOrigin.y + cross,
      strokeStyle,
    )

    // OBB from the bounds corners -> world -> screen. The bounds are a local
    // AABB, projected through the world transform.
    const b = node.bounds
    if (!b) return
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
      rectPts[i * 2] = s.x
      rectPts[i * 2 + 1] = s.y
    }
    gfx.strokePolyline(rectPts, 4, { ...strokeStyle, closed: true })
  })
}
