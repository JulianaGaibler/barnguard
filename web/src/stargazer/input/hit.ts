import type { SceneNode } from '../scene/SceneNode'
import { walkTree } from '../scene/traverse'

/**
 * Reverse-DFS hit walk, visits the scene tree in painter's-order and returns
 * the last-drawn (topmost) `hitEnabled` node whose `hitTest` accepts the point.
 * World-coord input; the node's `hitTest` handles the world→local transform
 * internally.
 *
 * When `root` is a scene's root, the flattened painter-order list is pulled
 * from `Scene.getPainterOrder()`, a cached array rebuilt only on tree mutation,
 * so hit tests during a drag storm allocate nothing. When `root` is a synthetic
 * subtree (e.g. tests), we fall back to a fresh `walkTree` allocation.
 *
 * @category Input
 */
export function findHitNode(
  root: SceneNode,
  worldX: number,
  worldY: number,
  touchSlopWorld: number,
): SceneNode | null {
  const scene = root.scene
  let painterOrder: readonly SceneNode[]
  if (scene && root === scene.root) {
    painterOrder = scene.getPainterOrder()
  } else {
    const scratch: SceneNode[] = []
    walkTree(root, (n) => scratch.push(n))
    painterOrder = scratch
  }
  for (let i = painterOrder.length - 1; i >= 0; i--) {
    const n = painterOrder[i]
    if (!n.hitEnabled || !n.visible) continue
    if (n.hitTest(worldX, worldY, touchSlopWorld)) return n
  }
  return null
}
