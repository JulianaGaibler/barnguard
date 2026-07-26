/**
 * The scene graph. One {@link SceneTree} holds a single tree of nodes sharing a
 * non-spatial {@link Node} base: 2D {@link Node2D}s and 3D {@link Node3D}s
 * coexist (Godot-style), rooted at `tree.root`. Each node carries a transform,
 * children, and optional {@link Behavior}s. Position nodes through their
 * transform, nest them with `.add`, and attach game logic as behaviors.
 * {@link walkTree} visits the tree in draw order; render passes bucket by
 * `node.kind`.
 *
 * The drawable primitives (ShapeNode, TextNode, MeshNode, …) live in the nodes
 * module.
 *
 * @module scene
 * @category Scene
 */
export { Node } from '../scene/Node'
export type { NodeOwner, NodeEvents, NodeKind } from '../scene/Node'
export { GroupNode } from '../scene/GroupNode'
export { SceneTree } from '../scene/SceneTree'
export { Node2D } from '../scene/Node2D'
export type { RenderLayer, PointerHandlers } from '../scene/Node2D'
export { Node3D } from '../scene/Node3D'
export type { Node3DTweenTo } from '../scene/Node3D'
export { Behavior } from '../scene/Behavior'
export type { BehaviorCtor } from '../scene/Behavior'
export { walkTree } from '../scene/traverse'
export { hitTestCircle } from '../scene/hitTest'
export { raycastWorld3D, raycastMesh, makeRay } from '../scene/raycast3d'
export type { Raycast3DHit } from '../scene/raycast3d'
