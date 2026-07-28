import type { GfxDevice } from './GfxDevice'
import { WebGL2Device } from './webgl2/WebGL2Device'
import { WebGPUDevice } from './webgpu/WebGPUDevice'

/**
 * Which backend to use. `'auto'` prefers WebGPU where it works and falls back
 * to WebGL2. `'webgpu'`/`'webgl2'` force one (forcing WebGPU throws if it is
 * unavailable rather than falling back).
 *
 * @category Render
 */
export type BackendPreference = 'auto' | 'webgpu' | 'webgl2'

/** The chosen device plus which backend it is, for the debug HUD / callers. */
export interface BackendSelection {
  device: GfxDevice
  backend: 'webgpu' | 'webgl2'
}

/**
 * How long the WebGPU capability probe waits for its trivial submit to finish
 * before giving up. A healthy device resolves in well under a frame. The cap
 * guards against a driver that reports a device then hangs on first submit.
 */
const PROBE_TIMEOUT_MS = 2000

/**
 * Probe whether WebGPU actually renders on this machine, on a throwaway device
 * (no canvas). Some drivers hand back a valid-looking device that then errors
 * or hangs on the first real submit, so a bare `requestDevice` is not enough:
 * this clears a 1×1 target inside a validation scope and waits for the work to
 * complete. A `<canvas>` is permanently bound to its first context type, so the
 * probe must NOT touch the real canvas (or a WebGL2 fallback on it would fail).
 */
async function probeWebGPU(): Promise<boolean> {
  if (!navigator.gpu) return false
  let device: GPUDevice | null = null
  try {
    const adapter = await navigator.gpu.requestAdapter()
    if (!adapter) return false
    device = await adapter.requestDevice()
    const gpu = device
    const work = (async (): Promise<boolean> => {
      gpu.pushErrorScope('validation')
      const tex = gpu.createTexture({
        size: [1, 1, 1],
        format: 'rgba8unorm',
        usage: GPUTextureUsage.RENDER_ATTACHMENT,
      })
      const encoder = gpu.createCommandEncoder()
      const pass = encoder.beginRenderPass({
        colorAttachments: [
          {
            view: tex.createView(),
            loadOp: 'clear',
            storeOp: 'store',
            clearValue: { r: 0, g: 0, b: 0, a: 1 },
          },
        ],
      })
      pass.end()
      gpu.queue.submit([encoder.finish()])
      const err = await gpu.popErrorScope()
      await gpu.queue.onSubmittedWorkDone()
      tex.destroy()
      return err === null
    })()
    const timeout = new Promise<boolean>((resolve) =>
      setTimeout(() => resolve(false), PROBE_TIMEOUT_MS),
    )
    return await Promise.race([work, timeout])
  } catch {
    return false
  } finally {
    device?.destroy()
  }
}

/**
 * Pick and construct the rendering backend for `canvas`. WebGPU acquisition is
 * async, so this is too. The caller builds the engine once it resolves. Once a
 * backend is chosen the canvas is committed to it (context type is permanent),
 * so a mid-session WebGPU loss is handled by remounting on a fresh canvas, not
 * here.
 *
 * @category Render
 */
export async function selectGfxDevice(
  canvas: HTMLCanvasElement,
  prefer: BackendPreference = 'auto',
): Promise<BackendSelection> {
  if (prefer !== 'webgl2' && (await probeWebGPU())) {
    return { device: await WebGPUDevice.create(canvas), backend: 'webgpu' }
  }
  if (prefer === 'webgpu') {
    throw new Error(
      'selectGfxDevice: WebGPU was requested but is unavailable on this device',
    )
  }
  return { device: new WebGL2Device(canvas), backend: 'webgl2' }
}
