import type { CameraView2D } from '../camera/CameraView2D'
import type { Node } from '../scene/Node'
import type { Node2D } from '../scene/Node2D'
import type { SceneTree } from '../scene/SceneTree'
import { isEffectivelyVisible, walkTree } from '../scene/traverse'

/** Which view places a node, or `null` to skip it. See `viewFor`. */
export type HitViewResolver = (node: Node2D) => CameraView2D | null

/** A screen point converted into one view's world, and the slop in its units. */
interface ViewPoint {
  view: CameraView2D
  x: number
  y: number
  slop: number
}

/** Reused between calls, at most a handful of views are ever live. */
const POINTS: ViewPoint[] = []

/**
 * Reverse-DFS hit walk: visits the tree's {@link Node2D}s in painter order and
 * returns the last-drawn (topmost) `hitEnabled` node whose `hitTest` accepts
 * the point. The point is a canvas position in CSS pixels, converted into each
 * node's own world through the view `resolveView` gives for it, so a node under
 * a layer with a space of its own is tested where that layer puts it. The touch
 * slop is in CSS pixels and becomes world units per view. 3D nodes are skipped
 * (they pick via a ray, not bounds).
 *
 * When `root` is a scene tree's root, the flattened painter-order list is
 * pulled from {@link SceneTree.getPainterOrder}, a cached array rebuilt only on
 * tree mutation, so hit tests during a drag storm allocate nothing. For a
 * synthetic subtree (e.g. tests), it falls back to a fresh `walkTree`
 * allocation.
 *
 * @example
 *   const hit = findHitNode(
 *     stage.tree.root,
 *     pointer.screen.x,
 *     pointer.screen.y,
 *     (node) => viewFor(node, stage),
 *     30,
 *   )
 */
export function findHitNode(
  root: Node,
  screenX: number,
  screenY: number,
  resolveView: HitViewResolver,
  touchSlopCssPx: number,
): Node2D | null {
  const owner = root.owner as SceneTree | null
  let painterOrder: readonly Node2D[]
  if (
    owner &&
    owner.root === root &&
    typeof owner.getPainterOrder === 'function'
  ) {
    painterOrder = owner.getPainterOrder()
  } else {
    const scratch: Node2D[] = []
    walkTree(root, (n) => {
      // Match SceneTree.getPainterOrder: intrinsic nodes (cameras) never hit-test.
      if (n.kind === '2d' && !n.intrinsic) scratch.push(n as Node2D)
    })
    painterOrder = scratch
  }
  let live = 0
  for (let i = painterOrder.length - 1; i >= 0; i--) {
    const n = painterOrder[i]
    if (!n.hitEnabled || !isEffectivelyVisible(n)) continue
    const view = resolveView(n)
    if (!view) continue
    let point: ViewPoint | null = null
    for (let k = 0; k < live; k++) {
      if (POINTS[k].view === view) {
        point = POINTS[k]
        break
      }
    }
    if (!point) {
      const p = (POINTS[live] ??= { view, x: 0, y: 0, slop: 0 })
      p.view = view
      const world = view.screenToWorld(screenX, screenY, WORLD_SCRATCH)
      p.x = world.x
      p.y = world.y
      const scale = view.screenPxPerWorldUnit()
      p.slop = scale > 0 ? touchSlopCssPx / scale : 0
      live++
      point = p
    }
    if (n.hitTest(point.x, point.y, point.slop)) return n
  }
  return null
}

const WORLD_SCRATCH = { x: 0, y: 0 }
