import type { Engine } from '../engine/Engine'

/**
 * Params for the {@link a11yRoot} Svelte action.
 *
 * @category Svelte
 */
export interface A11yRootParams {
  /** The engine whose accessibility tree fills this element. */
  engine: Engine
}

/**
 * Svelte action that hands an element to {@link AccessibilityTree} as its mount
 * point. The engine fills it with a hidden, screen-reader-readable mirror of
 * the registered scene nodes and makes it visually hidden. Place it where its
 * reading order relative to the canvas is correct — typically a sibling right
 * after the `<canvas>`.
 *
 * This is the only Svelte action for the a11y layer: canvas nodes are
 * registered from game code via `engine.a11y.attach`, and real HTML overlays
 * stay in their own DOM (linked by id string via `Semantics.links`), so no
 * per-node action is needed.
 *
 * @category Svelte
 * @example
 *   <canvas use:mountEngine={{ onReady }}></canvas>
 *   <div use:a11yRoot={{ engine: host.engine }}></div>
 */
export function a11yRoot(
  element: HTMLElement,
  params: A11yRootParams,
): { destroy(): void } {
  params.engine.a11y.mount(element)
  return {
    destroy(): void {
      // The subsystem drops the mount when the engine is destroyed; if only the
      // root element unmounts, clear its owned children so a remount is clean.
      if (params.engine.a11y.root === element) {
        element.replaceChildren()
      }
    },
  }
}
