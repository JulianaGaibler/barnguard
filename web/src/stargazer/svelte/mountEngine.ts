import {
  createEngineHost,
  type EngineHost,
  type EngineHostOptions,
} from '../engine/EngineHost'

export interface MountEngineActionParams {
  options?: Omit<EngineHostOptions, 'canvas'>
  onReady?: (host: EngineHost) => void | Promise<void>
  onDestroy?: (host: EngineHost) => void
}

/**
 * Svelte action for a `<canvas>` element. Constructs an `EngineHost`, fires
 * `onReady`, and tears down on unmount.
 *
 * @example
 *   <canvas use:mountEngine={{ options: { clearColor: '#0d1a2c' }, onReady }} />
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
