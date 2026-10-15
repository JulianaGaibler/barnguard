import type { Engine } from '../engine/Engine'
import type { RingSeries } from './RingSeries'

// GPU frame timing, for the quality panel and the benchmark.
//
// WebGL2 frames are timed with `EXT_disjoint_timer_query_webgl2` when the
// browser exposes it: one `TIME_ELAPSED` query spans the whole engine frame,
// from the first before-frame hook to the `frame` event, which fires after
// present. Results arrive a few frames later and are dropped when the GPU
// reports a disjoint event.
//
// WebGPU frames are timed with timestamp queries where the device has the
// `timestamp-query` feature: the first pass after a submit writes the start and
// the last pass the end. `queue.onSubmittedWorkDone` settles on the display
// refresh in Firefox, so it cannot stand in for GPU time.

/** Collects one GPU number per frame, or nothing when the browser has no way. */
export interface GpuFrameTimer {
  /** What the numbers mean: `elapsed` or `none`. */
  readonly kind: 'elapsed' | 'none'
  /** Milliseconds per measured frame, in arrival order. */
  readonly samples: number[]
  /** Start or stop recording into `samples`. Queries keep running either way. */
  recording: boolean
  dispose(): void
}

interface TimerQueryExt {
  readonly TIME_ELAPSED_EXT: number
  readonly GPU_DISJOINT_EXT: number
}

export function createGpuFrameTimer(
  engine: Engine,
  canvas: HTMLCanvasElement,
  /** Also receives each measured frame, in milliseconds. */
  series?: RingSeries,
): GpuFrameTimer {
  if (engine.primaryStage.backend === 'webgpu') {
    return timestampTimer(engine, series)
  }
  if (engine.primaryStage.backend !== 'webgl2') return noTimer()
  // Asking the canvas for its existing context type returns the engine's own
  // context, so the query brackets exactly the engine's GL calls.
  const gl = canvas.getContext('webgl2')
  const ext = gl?.getExtension(
    'EXT_disjoint_timer_query_webgl2',
  ) as TimerQueryExt | null
  if (!gl || !ext) return noTimer()
  return elapsedTimer(engine, gl, ext, series)
}

function timestampTimer(
  engine: Engine,
  series: RingSeries | undefined,
): GpuFrameTimer {
  const timer: GpuFrameTimer = {
    kind: 'elapsed',
    samples: [],
    recording: false,
    dispose() {
      off?.()
    },
  }
  const off = engine.primaryStage.device.onGpuFrameTime?.((ms) => {
    if (timer.recording) timer.samples.push(ms)
    series?.push(ms)
  })
  return off ? timer : noTimer()
}

function noTimer(): GpuFrameTimer {
  return { kind: 'none', samples: [], recording: false, dispose() {} }
}

function elapsedTimer(
  engine: Engine,
  gl: WebGL2RenderingContext,
  ext: TimerQueryExt,
  series: RingSeries | undefined,
): GpuFrameTimer {
  const pending: { query: WebGLQuery; record: boolean }[] = []
  let active: WebGLQuery | null = null
  const timer: GpuFrameTimer = {
    kind: 'elapsed',
    samples: [],
    recording: false,
    dispose() {
      offBefore()
      offFrame()
      if (active) gl.endQuery(ext.TIME_ELAPSED_EXT)
      for (const p of pending) gl.deleteQuery(p.query)
      pending.length = 0
    },
  }
  const poll = (): void => {
    const disjoint = gl.getParameter(ext.GPU_DISJOINT_EXT) as boolean
    while (pending.length > 0) {
      const head = pending[0]
      if (!gl.getQueryParameter(head.query, gl.QUERY_RESULT_AVAILABLE)) break
      const ns = gl.getQueryParameter(head.query, gl.QUERY_RESULT) as number
      if (!disjoint) {
        if (head.record) timer.samples.push(ns / 1e6)
        series?.push(ns / 1e6)
      }
      gl.deleteQuery(head.query)
      pending.shift()
    }
  }
  const offBefore = engine.onBeforeFrame(() => {
    poll()
    // A frame that threw before its `frame` event left its query open.
    if (active) {
      gl.endQuery(ext.TIME_ELAPSED_EXT)
      gl.deleteQuery(active)
      active = null
    }
    const query = gl.createQuery()
    if (!query) return
    gl.beginQuery(ext.TIME_ELAPSED_EXT, query)
    active = query
  })
  const offFrame = engine.events.on('frame', () => {
    if (!active) return
    gl.endQuery(ext.TIME_ELAPSED_EXT)
    pending.push({ query: active, record: timer.recording })
    active = null
  })
  return timer
}
