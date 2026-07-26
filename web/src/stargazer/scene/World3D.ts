import { Node3D } from './Node3D'
import { SceneTree } from './SceneTree'

/**
 * A {@link SceneTree} whose root defaults to a 3D {@link Node3D}. Kept for
 * standalone 3D use and backward compatibility; the engine's stages use a
 * {@link SceneTree} with a neutral {@link GroupNode} root that holds both 2D and
 * 3D content. `updateTransforms()` composes the 3D world matrices.
 *
 * @category Scene
 * @example
 *   const world = new SceneTree(new Node3D('world3d-root'))
 *   world.add(new MeshNode(cubeGeometry, unlitMaterial))
 *   world.updateTransforms()
 */
export class World3D extends SceneTree {
  /** Narrowed: a `World3D`'s root is always a {@link Node3D}. */
  declare readonly root: Node3D

  constructor(root: Node3D = new Node3D('world3d-root')) {
    super(root)
  }
}
