import { Node2D } from './Node2D'
import { SceneTree } from './SceneTree'

/**
 * A {@link SceneTree} whose root defaults to a 2D {@link Node2D}. Kept for
 * standalone 2D use and backward compatibility; the engine's stages use a
 * {@link SceneTree} with a neutral {@link GroupNode} root that holds both 2D and
 * 3D content.
 *
 * @category Scene
 */
export class Scene extends SceneTree {
  /** Narrowed: a `Scene`'s root is always a {@link Node2D}. */
  declare readonly root: Node2D

  constructor(root: Node2D = new Node2D('scene-root')) {
    super(root)
  }
}
