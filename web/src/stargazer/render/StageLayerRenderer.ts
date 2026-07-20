// The per-layer node walk: viewport cull, compose the final transform, draw.
// Split out of `Stage` because it's a self-contained loop with its own
// scratch state (the cull-rect corners), independent of `Stage`'s render
// dispatch, static-cache bookkeeping, and resize handling.

import type { Camera } from '../camera/Camera'
import type { Vec2 } from '../math/Vec2'
import type { Scene } from '../scene/Scene'
import type { RenderLayer, SceneNode } from '../scene/SceneNode'
import type { Gfx2D } from './gfx/Gfx2D'
import type { Renderer } from './Renderer'

/**
 * World-unit slack on viewport cull, on top of stroke half-width. Covers AA
 * edges and sub-pixel drift so nodes don't pop early at the boundary.
 */
const CULL_AA_PAD_WORLD = 2

/**
 * Walks one render layer's nodes, culls, and draws. Owns the cull-rect scratch
 * buffers so `Stage.render` doesn't allocate a `Vec2` pair per frame.
 *
 * @category Render
 */
export class StageLayerRenderer {
  // Scratch for the per-layer viewport-cull bounds, reused each frame.
  readonly #cullTL: Vec2 = { x: 0, y: 0 }
  readonly #cullBR: Vec2 = { x: 0, y: 0 }

  drawLayer(
    scene: Scene,
    renderer: Renderer,
    layer: RenderLayer,
    gfx: Gfx2D,
    camera: Camera,
    scaleDpr: number,
    offX: number,
    offY: number,
    dt: number,
  ): void {
    const marks = scene.engine?.perfMarks ?? false
    // Cull rect from the canvas corners (not the camera viewport) so it
    // includes letterbox margins, otherwise content still on screen in the
    // uncovered axis clips.
    const cssW = renderer.cssSize.w
    const cssH = renderer.cssSize.h
    camera.screenToWorld(0, 0, this.#cullTL)
    camera.screenToWorld(cssW, cssH, this.#cullBR)
    const visLeft = Math.min(this.#cullTL.x, this.#cullBR.x)
    const visRight = Math.max(this.#cullTL.x, this.#cullBR.x)
    const visTop = Math.min(this.#cullTL.y, this.#cullBR.y)
    const visBottom = Math.max(this.#cullTL.y, this.#cullBR.y)
    const strokeScale = camera.strokeSpaceScale()

    const layerNodes = scene.getLayerNodes(layer)
    for (let i = 0; i < layerNodes.length; i++) {
      const node = layerNodes[i]
      if (!node.visible) continue
      if (!node.draw) continue
      // Skip nodes whose bounds are fully outside the visible rect. Only nodes
      // that declare `debugBounds` can be culled; the rest always draw.
      if (
        node.debugBounds &&
        this.#isOutsideView(
          node,
          strokeScale,
          visLeft,
          visRight,
          visTop,
          visBottom,
        )
      ) {
        continue
      }
      const w = node.transform.world
      // final = (DPR × camera-uniform) × node.world
      // camera has zero skew and uniform scale, so we hand-compose in 2D:
      const fA = scaleDpr * w.a
      const fB = scaleDpr * w.b
      const fC = scaleDpr * w.c
      const fD = scaleDpr * w.d
      const fE = scaleDpr * w.e + offX
      const fF = scaleDpr * w.f + offY
      gfx.setBaseTransform(fA, fB, fC, fD, fE, fF)
      gfx.setAlpha(node.transform.alpha)
      const id = marks ? node.id : ''
      const startMark = marks ? `draw-${id}:start` : ''
      if (marks) performance.mark(startMark)
      node.draw(gfx, camera, dt)
      if (marks) {
        const endMark = `draw-${id}:end`
        performance.mark(endMark)
        performance.measure(`draw ${id}`, startMark, endMark)
      }
    }
    gfx.setAlpha(1)
  }

  /**
   * True when `node`'s world-space AABB lies fully outside the visible rect
   * (with a stroke + AA margin). The AABB is the node's local `debugBounds`
   * pushed through its world matrix (all four corners, so rotated nodes are
   * handled). The margin adds the node's own stroke half-width. CSS-px strokes
   * convert to world via `strokeScale`, so a state whose FILL is just
   * off-screen doesn't get its visible stroke clipped.
   */
  #isOutsideView(
    node: SceneNode,
    strokeScale: number,
    visLeft: number,
    visRight: number,
    visTop: number,
    visBottom: number,
  ): boolean {
    const b = node.debugBounds!
    const w = node.transform.world
    const x0 = b.x
    const y0 = b.y
    const x1 = b.x + b.width
    const y1 = b.y + b.height
    // Four local corners → world.
    const wx0 = w.a * x0 + w.c * y0 + w.e
    const wy0 = w.b * x0 + w.d * y0 + w.f
    const wx1 = w.a * x1 + w.c * y0 + w.e
    const wy1 = w.b * x1 + w.d * y0 + w.f
    const wx2 = w.a * x1 + w.c * y1 + w.e
    const wy2 = w.b * x1 + w.d * y1 + w.f
    const wx3 = w.a * x0 + w.c * y1 + w.e
    const wy3 = w.b * x0 + w.d * y1 + w.f
    const minX = Math.min(wx0, wx1, wx2, wx3)
    const maxX = Math.max(wx0, wx1, wx2, wx3)
    const minY = Math.min(wy0, wy1, wy2, wy3)
    const maxY = Math.max(wy0, wy1, wy2, wy3)

    // Stroke half-width in world units (0 for non-stroked nodes). Screen-space
    // strokes (the default) scale by `strokeScale`; world-space strokes are
    // already in world units.
    const strokeNode = node as { lineWidth?: number; strokeSpace?: string }
    const lw = strokeNode.lineWidth ?? 0
    const worldStrokeHalf =
      lw > 0
        ? (strokeNode.strokeSpace === 'world' ? lw : lw * strokeScale) * 0.5
        : 0
    const m = worldStrokeHalf + CULL_AA_PAD_WORLD

    return (
      maxX < visLeft - m ||
      minX > visRight + m ||
      maxY < visTop - m ||
      minY > visBottom + m
    )
  }
}
