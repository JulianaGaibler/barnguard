import type { Node } from './Node'

/**
 * Visit every node in a subtree depth-first, parents before children and each
 * node's children left to right. This is painter order: `visit` sees nodes in
 * the sequence they should draw. `root` itself is visited first.
 *
 * The tree is heterogeneous ({@link Node2D} and {@link Node3D} can coexist),
 * so `visit` receives the base `Node`; branch on `node.kind` (or narrow) when a
 * walk only cares about one dimension. Passing a subtree root of a single kind
 * infers `N` to that type, so a homogeneous walk keeps its concrete typing.
 *
 * @category Scene
 */
export function walkTree<N extends Node>(
  root: N,
  visit: (node: N) => void,
): void {
  visit(root)
  const children = root.children
  for (let i = 0; i < children.length; i++) {
    // Descendants are the base `Node`; a homogeneous caller narrows `N` for its
    // own subtree, so this cast matches that intent (mixed callers pass `Node`).
    walkTree(children[i] as N, visit)
  }
}
