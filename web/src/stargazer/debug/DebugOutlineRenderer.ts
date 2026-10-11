// Per-node pivot cross + OBB outline overlay for the debug HUD. Pure function
// of the scene tree + camera, no controller state.

import type { CameraView2D } from '../camera/CameraView2D'
import type { Stage } from '../render/Stage'
import type { Gfx2D } from '../render/gfx/Gfx2D'
import type { Node2D } from '../scene/Node2D'
import { walkTree } from '../scene/traverse'

/**
 * Draw a pivot cross + OBB outline for every visible, `debugVisible` node in
 * `stage`'s scene. Called by `DebugController.drawOverlay` when the outlines
 * toggle is on.
 */
/**
 * A node this engine's own primitives (`ShapeNode`, `Path2DNode`,
 * `PolylineNode`) duck-type, same as `StageLayerRenderer`'s cull test:
 * `lineWidth` is a stroke half-width in node-space units, `cullMargin` folds in
 * whatever else can paint outside `debugBounds` (an outside-aligned border, a
 * shadow's offset/blur/spread), and `strokeSpace` says whether either follows
 * the camera's screen scale or stays in world units as-is.
 */
interface CullMarginNode {
  lineWidth?: number
  strokeSpace?: string
  cullMargin?: number
}

export function drawNodeOutlines(
  gfx: Gfx2D,
  stage: Stage,
  cam: CameraView2D,
): void {
  const strokeStyle = { color: 'rgba(96, 165, 250, 0.6)', width: 1 }
  const cullStyle = { color: 'rgba(244, 114, 182, 0.5)', width: 1 }
  const rectPts = new Float32Array(8)
  const strokeScale = cam.strokeSpaceScale()

  walkTree(stage.tree.root, (n) => {
    if (n.kind !== '2d') return
    const node = n as Node2D
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

    // OBB from debugBounds corners → world → screen. See scene/Node2D.ts
    // for the debug-bounds convention (local AABB, projected through world).
    const b = node.debugBounds
    if (!b) return
    const corners: Array<[number, number]> = [
      [b.x, b.y],
      [b.x + b.width, b.y],
      [b.x + b.width, b.y + b.height],
      [b.x, b.y + b.height],
    ]
    const worldX: number[] = []
    const worldY: number[] = []
    for (let i = 0; i < 4; i++) {
      const lx = corners[i][0]
      const ly = corners[i][1]
      const wx = w.a * lx + w.c * ly + w.e
      const wy = w.b * lx + w.d * ly + w.f
      worldX.push(wx)
      worldY.push(wy)
      const s = cam.worldToScreen(wx, wy)
      rectPts[i * 2] = s.x
      rectPts[i * 2 + 1] = s.y
    }
    gfx.strokePolyline(rectPts, 4, { ...strokeStyle, closed: true })

    // Cull box: what a node can paint beyond its OBB (an outside-aligned
    // border, a shadow's offset/blur/spread), same formula and units
    // `StageLayerRenderer.#isOutsideView` culls against. Flat margin on the
    // OBB's own axis-aligned world bounding box, not a per-edge offset: a
    // rotated node's cull box is axis-aligned too, matching what actually
    // gets culled.
    const cullNode = node as CullMarginNode
    const raw = (cullNode.lineWidth ?? 0) * 0.5 + (cullNode.cullMargin ?? 0)
    if (raw <= 0) return
    const m = cullNode.strokeSpace === 'world' ? raw : raw * strokeScale
    const minX = Math.min(...worldX) - m
    const maxX = Math.max(...worldX) + m
    const minY = Math.min(...worldY) - m
    const maxY = Math.max(...worldY) + m
    const cullCorners: Array<[number, number]> = [
      [minX, minY],
      [maxX, minY],
      [maxX, maxY],
      [minX, maxY],
    ]
    for (let i = 0; i < 4; i++) {
      const s = cam.worldToScreen(cullCorners[i][0], cullCorners[i][1])
      rectPts[i * 2] = s.x
      rectPts[i * 2 + 1] = s.y
    }
    gfx.strokePolyline(rectPts, 4, {
      ...cullStyle,
      dash: [4, 3],
      closed: true,
    })
  })
}
