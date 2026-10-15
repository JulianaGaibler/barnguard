import type { CameraView2D } from '../camera/CameraView2D'
import type { Stage } from '../render/Stage'
import { Layer } from './Layer'
import type { Node } from './Node'

/** The part of the debug controller `viewFor` consults. */
export interface ViewDebug {
  activeCameraFor(stage: Stage): CameraView2D | null
}

/**
 * The nearest layer at or above `node` that places its subtree by a view of its
 * own, or `null` when the node is placed by the stage's camera.
 */
export function layerOf(node: Node): Layer | null {
  for (let n: Node | null = node; n; n = n.parent) {
    if (n instanceof Layer && n.space !== 'world') return n
  }
  return null
}

/**
 * The view that places `node`: its layer's view when it is under a layer with a
 * space of its own, otherwise the stage's camera, or the debug camera while it
 * is engaged. `null` when the stage has no camera yet.
 *
 * Use it wherever a node's position on screen matters, such as anchoring HTML
 * to it, converting a pointer position into its local space, or sizing a
 * layout. The stage's camera is the wrong answer for a node under a screen or
 * frame layer.
 *
 * @remarks
 *   The debug camera only replaces the stage's camera. A layer with a space of
 *   its own ignores it, the way a heads-up display would.
 * @example
 *   const view = viewFor(label, stage)
 *   const screen = view?.worldToScreen(
 *     label.transform.world.e,
 *     label.transform.world.f,
 *   )
 */
export function viewFor(
  node: Node,
  stage: Stage,
  debug?: ViewDebug | null,
): CameraView2D | null {
  const layer = layerOf(node)
  if (layer) {
    const size = stage.renderer.cssSize
    layer._syncView(size.w, size.h)
    return layer.view
  }
  return debug?.activeCameraFor(stage) ?? stage.currentCamera2D
}
