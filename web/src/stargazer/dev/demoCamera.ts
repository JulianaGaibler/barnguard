import { CameraNode2D } from '../camera/CameraNode2D'
import type { SceneTree } from '../scene/SceneTree'
import type { Rect } from '../math/Rect'

/**
 * Dev-only convenience: add a current 2D camera framing `viewport` to a demo
 * scene. Cameras aren't auto-created, so each demo declares one explicitly.
 */
export function addDemoCamera(tree: SceneTree, viewport: Rect): CameraNode2D {
  const cam = new CameraNode2D('demo-camera')
  cam.setViewport(viewport)
  tree.root.add(cam)
  cam.makeCurrent()
  return cam
}
