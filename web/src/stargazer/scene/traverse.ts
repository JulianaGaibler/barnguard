import type { Node } from './Node'

/**
 * Visit every node in a subtree depth-first, parents before children and each
 * node's children left to right. This is painter order: `visit` sees nodes in
 * the sequence they should draw. `root` itself is visited first.
 *
 * The tree is heterogeneous ({@link Node2D} and {@link Node3D} can coexist), so
 * `visit` receives the base `Node`. Branch on `node.kind` (or narrow) when a
 * walk only cares about one dimension. Passing a subtree root of a single kind
 * infers `N` to that type, so a homogeneous walk keeps its concrete typing.
 */
export function walkTree<N extends Node>(
  root: N,
  visit: (node: N) => void,
): void {
  visit(root)
  const children = root.children
  for (let i = 0; i < children.length; i++) {
    // Descendants are the base `Node`. A homogeneous caller narrows `N` for its
    // own subtree, so this cast matches that intent (mixed callers pass `Node`).
    walkTree(children[i] as N, visit)
  }
}

/**
 * Bumped whenever any node's `visible` changes or any node is added or removed,
 * which is when a cached answer from {@link isEffectivelyVisible} can go stale.
 */
let visibilityEpoch = 0

/** Mark every cached visibility answer stale. */
export function invalidateVisibility(): void {
  visibilityEpoch++
}

/**
 * Whether a node draws, accounting for its ancestors.
 *
 * Hiding a node hides everything under it, so a group is a working switch for
 * its whole subtree. The render and hit walks read flattened per-layer lists
 * rather than descending the tree, so each one has to ask rather than infer it
 * from the walk.
 *
 * @remarks
 *   The answer is cached on each node and on its ancestors, and reused until a
 *   `visible` flag or the tree changes anywhere. A frame with neither answers
 *   every node without walking its ancestors.
 */
export function isEffectivelyVisible(node: Node): boolean {
  if (node._visibleEpoch === visibilityEpoch) return node._visibleCached
  const parent = node.parent
  const visible = node.visible && (parent ? isEffectivelyVisible(parent) : true)
  node._visibleEpoch = visibilityEpoch
  node._visibleCached = visible
  return visible
}
