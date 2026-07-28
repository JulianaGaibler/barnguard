import {
  createEngineHost,
  type EngineHost,
  type EngineHostOptions,
} from '../engine/EngineHost'
import { WebGPUDevice } from '../render/gfx/webgpu/WebGPUDevice'

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
   * Rendering backend. `'webgpu'` acquires a `WebGPUDevice` (async) and injects
   * it; anything else takes the default synchronous WebGL2 path. A backend set
   * in `options.gpuDevice` wins over this.
   */
  backend?: 'webgl2' | 'webgpu'
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
  const wantsWebGPU = params.backend === 'webgpu' && !params.options?.gpuDevice
  if (!wantsWebGPU) {
    // Synchronous WebGL2 (or caller-injected device) path.
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

  // WebGPU: acquire the device asynchronously, then build the host. `destroy`
  // may run before the device resolves, so guard the teardown on a flag.
  let host: EngineHost | null = null
  let destroyed = false
  const readyPromise = WebGPUDevice.create(canvas).then(async (gpuDevice) => {
    if (destroyed) {
      gpuDevice.destroy()
      return
    }
    host = createEngineHost({ canvas, ...(params.options ?? {}), gpuDevice })
    await params.onReady?.(host)
  })

  return {
    destroy() {
      destroyed = true
      readyPromise
        .catch((err) => {
          console.error('[stargazer] mountEngine (webgpu) failed:', err)
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
