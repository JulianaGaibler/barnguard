import type { Engine } from '../engine/Engine'
import type { SceneNode } from '../scene/SceneNode'
import type { DomAttachment, DomAttachOptions } from '../dom/DomTransformSync'

/**
 * Params for the {@link domAnchor} Svelte action.
 *
 * @category Svelte
 */
export interface DomAnchorParams extends DomAttachOptions {
  /** The engine that drives the sync. */
  engine: Engine
  /** The scene node whose transform the element follows. */
  node: SceneNode
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
