// Per-node pivot cross + OBB outline overlay for the debug HUD. Pure function
// of the scene tree + camera, no controller state.

import type { Camera } from '../camera/Camera'
import type { Stage } from '../render/Stage'
import type { Gfx2D } from '../render/gfx/Gfx2D'
import { walkTree } from '../scene/traverse'

/**
 * Draw a pivot cross + OBB outline for every visible, `debugVisible` node in
 * `stage`'s scene. Called by `DebugController.drawOverlay` when the outlines
 * toggle is on.
 */
export function drawNodeOutlines(gfx: Gfx2D, stage: Stage, cam: Camera): void {
  const strokeStyle = { color: 'rgba(96, 165, 250, 0.6)', width: 1 }
  const rectPts = new Float32Array(8)

  walkTree(stage.scene.root, (node) => {
    if (!node.debugVisible || !node.visible) return
    const w = node.transform.world
    // Pivot cross at node origin.
    const px = w.e
    const py = w.f
    const screenOrigin = cam.worldToScreen(px, py)
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

    // OBB from debugBounds corners → world → screen. See scene/SceneNode.ts
    // for the debug-bounds convention (local AABB, projected through world).
    const b = node.debugBounds
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
      const s = cam.worldToScreen(wx, wy)
      rectPts[i * 2] = s.x
      rectPts[i * 2 + 1] = s.y
    }
    gfx.strokePolyline(rectPts, 4, { ...strokeStyle, closed: true })
  })
}
