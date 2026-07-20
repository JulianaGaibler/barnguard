import type { SceneNode } from './SceneNode'

/**
 * Visit every node in a subtree depth-first, parents before children and each
 * node's children left to right. This is painter order: `visit` sees nodes in
 * the sequence they should draw. `root` itself is visited first.
 *
 * @category Scene
 */
export function walkTree(
  root: SceneNode,
  visit: (node: SceneNode) => void,
): void {
  visit(root)
  const children = root.children
  for (let i = 0; i < children.length; i++) {
    walkTree(children[i], visit)
  }
}
