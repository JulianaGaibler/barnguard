export { createGpuFrameTimer, type GpuFrameTimer } from '../debug/GpuFrameTimer'

/** Facts about the machine and browser that the numbers depend on. */
export interface BenchEnvironment {
  /** The `&label=` parameter, naming the machine. */
  label: string | null
  userAgent: string
  platform: string
  cores: number
  devicePixelRatio: number
  screen: string
  window: string
  webglRenderer: string | null
  webgpuAdapter: string | null
  timerQueryWebGL2: boolean
  /** Whether the WebGPU adapter can time frames with timestamp queries. */
  timestampQueryWebGPU: boolean
}

export async function describeEnvironment(): Promise<BenchEnvironment> {
  const probe = document.createElement('canvas')
  const gl = probe.getContext('webgl2')
  let webglRenderer: string | null = null
  let timerQueryWebGL2 = false
  if (gl) {
    // Firefox reports the GPU in `RENDERER` and warns on the debug extension.
    // Chrome and Safari report a fixed string there and need the extension.
    webglRenderer = String(gl.getParameter(gl.RENDERER))
    if (webglRenderer.startsWith('WebKit')) {
      const info = gl.getExtension('WEBGL_debug_renderer_info')
      if (info)
        webglRenderer = String(gl.getParameter(info.UNMASKED_RENDERER_WEBGL))
    }
    timerQueryWebGL2 =
      gl.getExtension('EXT_disjoint_timer_query_webgl2') !== null
  }
  let webgpuAdapter: string | null = null
  let timestampQueryWebGPU = false
  try {
    const adapter = await navigator.gpu?.requestAdapter()
    if (adapter) {
      const i = adapter.info
      webgpuAdapter =
        [i.vendor, i.architecture, i.device, i.description]
          .filter((s) => s)
          .join(' / ') || 'unnamed adapter'
      timestampQueryWebGPU = adapter.features.has('timestamp-query')
    }
  } catch {
    webgpuAdapter = null
  }
  const nav = navigator as Navigator & {
    userAgentData?: { platform?: string }
  }
  return {
    label: new URLSearchParams(window.location.search).get('label'),
    userAgent: navigator.userAgent,
    platform: nav.userAgentData?.platform ?? navigator.platform,
    cores: navigator.hardwareConcurrency,
    devicePixelRatio: window.devicePixelRatio,
    screen: `${screen.width}x${screen.height}`,
    window: `${window.innerWidth}x${window.innerHeight}`,
    webglRenderer,
    webgpuAdapter,
    timerQueryWebGL2,
    timestampQueryWebGPU,
  }
}
