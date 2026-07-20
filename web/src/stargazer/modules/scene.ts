/**
 * The scene graph. A {@link Scene} holds a tree of {@link SceneNode}s rooted at
 * `scene.root`; each node carries a transform, children, and optional
 * {@link Behavior}s. Position nodes through their transform, nest them with
 * `SceneNode.add`, and attach game logic as behaviors. {@link walkTree} visits a
 * subtree in draw order.
 *
 * The drawable primitives (ShapeNode, TextNode, …) live in the nodes module.
 *
 * @module scene
 * @category Scene
 */
export { Scene } from '../scene/Scene'
export { SceneNode } from '../scene/SceneNode'
export type { RenderLayer, NodeEvents } from '../scene/SceneNode'
export { Behavior } from '../scene/Behavior'
export type { BehaviorCtor } from '../scene/Behavior'
export { walkTree } from '../scene/traverse'
export { hitTestCircle } from '../scene/hitTest'
