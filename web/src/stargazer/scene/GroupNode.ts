import { Node, type NodeKind } from './Node'

/**
 * A transform-less node: the unified tree root and a logical grouping node
 * (Godot's plain `Node`). It has no coordinate system of its own, so nesting a
 * `GroupNode` between spatial nodes doesn't affect their transforms — the
 * children resolve their world from the nearest same-`kind` ancestor, skipping
 * the group. Use it to group unrelated content under one parent for lifecycle
 * and visibility without imposing a 2D or 3D transform.
 *
 * @category Scene
 * @example
 *   const level = new GroupNode('level')
 *   level.add(hud, world) // hud is 2D, world holds 3D — one subtree, one destroy
 */
export class GroupNode extends Node {
  readonly kind: NodeKind = 'group'

  constructor(id?: string) {
    super(id)
  }
}
