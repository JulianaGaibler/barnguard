import type { SceneNode } from './SceneNode'

/** Depth-first pre-order visit (parents before children). */
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
