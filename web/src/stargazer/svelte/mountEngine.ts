import {
  createEngineHost,
  type EngineHost,
  type EngineHostOptions,
} from '../engine/EngineHost'
import {
  selectGfxDevice,
  type BackendPreference,
} from '../render/gfx/selectBackend'

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
  /**
   * Rendering backend. `'auto'` (default) prefers WebGPU where it works and
   * falls back to WebGL2. `'webgpu'`/`'webgl2'` force one. A device supplied
   * via `options.gpuDevice` wins over this and takes the synchronous path.
   */
  backend?: BackendPreference
  /**
   * Fires when a WebGPU device is lost unrecoverably. Recover by re-keying this
   * canvas (so `mountEngine` re-runs on a fresh node) and passing `backend:
   * 'webgl2'` on the remount, a lost WebGPU canvas can't be reused. Without it
   * the host reloads the page.
   */
  onBackendLost?: () => void
}

/**
 * Svelte action for a `<canvas>` element. Selects a rendering backend, builds
 * an {@link EngineHost} from the element, fires `onReady`, and calls
 * `host.destroy()` on unmount. This is the only part of stargazer that touches
 * the DOM, use it instead of calling {@link createEngineHost} by hand so scene
 * teardown is tied to the component lifecycle.
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
  const prefer = params.backend ?? 'auto'

  // Synchronous path: a caller-injected device, or WebGL2 forced. WebGL2
  // acquires its context synchronously, so the host is built immediately (and
  // tests relying on a mock device stay synchronous).
  if (params.options?.gpuDevice || prefer === 'webgl2') {
    const host = createEngineHost({
      canvas,
      ...(params.options ?? {}),
      onBackendLost: params.onBackendLost ?? params.options?.onBackendLost,
    })
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

  // Async path: probe + select the backend (WebGPU acquisition is async), then
  // build the host. `destroy` may run before selection resolves, so guard the
  // teardown on a flag and drop the device if it arrives after unmount.
  let host: EngineHost | null = null
  let destroyed = false
  const readyPromise = selectGfxDevice(canvas, prefer).then(
    async ({ device, backend }) => {
      if (destroyed) {
        device.destroy()
        return
      }
      console.info(`[stargazer] rendering backend: ${backend}`)
      host = createEngineHost({
        canvas,
        ...(params.options ?? {}),
        onBackendLost: params.onBackendLost ?? params.options?.onBackendLost,
        gpuDevice: device,
      })
      await params.onReady?.(host)
    },
  )

  return {
    destroy() {
      destroyed = true
      readyPromise
        .catch((err) => {
          console.error(
            '[stargazer] mountEngine backend selection failed:',
            err,
          )
        })
        .finally(() => {
          if (!host) return
          try {
            params.onDestroy?.(host)
          } finally {
            host.destroy()
          }
        })
    },
  }
}
