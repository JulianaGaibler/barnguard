import type { Node2D } from './Node2D'

// Reused across calls; hit-testing is synchronous, so there's no reentrancy.
const scratch = { x: 0, y: 0 }

/**
 * Circle hit-test in a node's local space: true when the world point, grown by
 * `touchSlop`, falls within `radius` of the node's local origin. Maps the point
 * through {@link Node2D.worldToLocal} (which syncs the world transform), so
 * it stays correct mid-frame. Used by the circle primitive and by any node
 * whose shape is a centered circle.
 *
 * @category Scene
 */
export function hitTestCircle(
  node: Node2D,
  worldX: number,
  worldY: number,
  radius: number,
  touchSlop: number,
): boolean {
  const p = node.worldToLocal(worldX, worldY, scratch)
  const r = radius + touchSlop
  return p.x * p.x + p.y * p.y <= r * r
}
