import type { Node } from '../scene/Node'
import type { Node2D } from '../scene/Node2D'
import type { SceneTree } from '../scene/SceneTree'
import { walkTree } from '../scene/traverse'

/**
 * Reverse-DFS hit walk: visits the tree's {@link Node2D}s in painter order and
 * returns the last-drawn (topmost) `hitEnabled` node whose `hitTest` accepts
 * the point. World-coord input; the node's `hitTest` handles the world→local
 * transform internally. 3D nodes are skipped (they pick via a ray, not
 * bounds).
 *
 * When `root` is a scene tree's root, the flattened painter-order list is
 * pulled from {@link SceneTree.getPainterOrder}, a cached array rebuilt only on
 * tree mutation, so hit tests during a drag storm allocate nothing. For a
 * synthetic subtree (e.g. tests), it falls back to a fresh `walkTree`
 * allocation.
 *
 * @category Input
 */
export function findHitNode(
  root: Node,
  worldX: number,
  worldY: number,
  touchSlopWorld: number,
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
  for (let i = painterOrder.length - 1; i >= 0; i--) {
    const n = painterOrder[i]
    if (!n.hitEnabled || !n.visible) continue
    if (n.hitTest(worldX, worldY, touchSlopWorld)) return n
  }
  return null
}
