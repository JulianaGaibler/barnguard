import {
  createEngineHost,
  type EngineHost,
  type EngineHostOptions,
} from '../engine/EngineHost'

/**
 * Params for the {@link mountEngine} Svelte action.
 *
 * @category Svelte
 */
export interface MountEngineActionParams {
  /** Host options minus `canvas`, which the action supplies from the element. */
  options?: Omit<EngineHostOptions, 'canvas'>
  /** Fires after the host is constructed; build your scene here. */
  onReady?: (host: EngineHost) => void | Promise<void>
  /** Fires before the host is destroyed on unmount. */
  onDestroy?: (host: EngineHost) => void
}

/**
 * Svelte action for a `<canvas>` element. Constructs an {@link EngineHost} from
 * the element, fires `onReady`, and calls `host.destroy()` on unmount. This is
 * the only part of stargazer that touches the DOM, use it instead of calling
 * {@link createEngineHost} by hand so scene teardown is tied to the component
 * lifecycle.
 *
 * Attach it as `use:mountEngine={{ options, onReady }}`, then load the scene
 * and call `host.start()` inside `onReady`.
 *
 * @category Svelte
 */
export function mountEngine(
  canvas: HTMLCanvasElement,
  params: MountEngineActionParams = {},
): { destroy(): void } {
  const host = createEngineHost({ canvas, ...(params.options ?? {}) })
  const readyPromise = Promise.resolve().then(() => params.onReady?.(host))

  return {
    destroy() {
      readyPromise
        .catch((err) => {
          console.error('[stargazer] mountEngine.onReady failed:', err)
        })
        .finally(() => {
          try {
            params.onDestroy?.(host)
          } finally {
            host.destroy()
          }
        })
    },
  }
}
