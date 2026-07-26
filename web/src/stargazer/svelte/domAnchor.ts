import type { Engine } from '../engine/Engine'
import type { Node2D } from '../scene/Node2D'
import type { Node3D } from '../scene/Node3D'
import type { Camera3D } from '../camera/Camera3D'
import type {
  DomAttachment,
  DomAttachOptions,
  Dom3DAttachment,
  Dom3DAttachOptions,
} from '../dom/DomTransformSync'

/**
 * Params for the {@link domAnchor} Svelte action.
 *
 * @category Svelte
 */
export interface DomAnchorParams extends DomAttachOptions {
  /** The engine that drives the sync. */
  engine: Engine
  /** The scene node whose transform the element follows. */
  node: Node2D
}

/**
 * Svelte action that keeps an element flush with a scene node. Attaches the
 * element to the node via {@link Engine.dom} on mount and detaches on unmount;
 * the engine then writes the element's CSS transform each frame so it tracks
 * the node through camera pans and zooms.
 *
 * The element must live in a container that overlays the canvas exactly (same
 * bounding rect); this action only drives the transform. See the HTML overlays
 * guide.
 *
 * @category Svelte
 * @example
 *   <div use:domAnchor={{ engine: host.engine, node, size: { width: 480, height: 320 } }}>
 *   <Menu />
 *   </div>
 */
export function domAnchor(
  element: HTMLElement,
  params: DomAnchorParams,
): { update(next: DomAnchorParams): void; destroy(): void } {
  let node = params.node
  let handle: DomAttachment = params.engine.dom.attach(node, element, params)
  return {
    update(next: DomAnchorParams): void {
      // Re-attach only when the target node (or engine) changes; otherwise just
      // push the new options so an inline params object doesn't churn attaches.
      if (next.engine !== params.engine || next.node !== node) {
        handle.detach()
        handle = next.engine.dom.attach(next.node, element, next)
        node = next.node
      } else {
        handle.setOptions(next)
      }
      params = next
    },
    destroy(): void {
      handle.detach()
    },
  }
}

/**
 * Params for the {@link domAnchor3d} Svelte action.
 *
 * @category Svelte
 */
export interface DomAnchor3dParams extends Dom3DAttachOptions {
  /** The engine that drives the sync. */
  engine: Engine
  /** The 3D node whose projected screen position the element follows. */
  node: Node3D
  /** The camera to project through (usually `engine.camera3d`). */
  camera: Camera3D
}

/**
 * Svelte action that pins an element to a {@link Node3D}'s projected screen
 * position. Attaches via {@link Engine.dom} on mount and detaches on unmount;
 * the engine projects the node through `camera` each frame, translates the
 * element (centered on the point), and hides it when the node is behind the
 * camera. Position-only, so the element stays screen-upright.
 *
 * The element must live in a container overlaying the canvas exactly. See the
 * HTML overlays guide.
 *
 * @category Svelte
 * @example
 *   <div use:domAnchor3d={{ engine, node: cube, camera: engine.camera3d }}>
 *     <button onclick={fire}>Launch</button>
 *   </div>
 */
export function domAnchor3d(
  element: HTMLElement,
  params: DomAnchor3dParams,
): { update(next: DomAnchor3dParams): void; destroy(): void } {
  let node = params.node
  let camera = params.camera
  let handle: Dom3DAttachment = params.engine.dom.attachWorld3d(
    node,
    element,
    camera,
    params,
  )
  return {
    update(next: DomAnchor3dParams): void {
      if (
        next.engine !== params.engine ||
        next.node !== node ||
        next.camera !== camera
      ) {
        handle.detach()
        handle = next.engine.dom.attachWorld3d(next.node, element, next.camera, next)
        node = next.node
        camera = next.camera
      } else {
        handle.setOptions(next)
      }
      params = next
    },
    destroy(): void {
      handle.detach()
    },
  }
}
