import { createEngineHost, type EngineHost } from '../engine/EngineHost'
import { WebGPUDevice } from '../render/gfx/webgpu/WebGPUDevice'
import {
  addBenchCamera,
  benchScenes,
  lottieChoice,
  type BenchScene,
} from './benchScenes'
import {
  createGpuFrameTimer,
  describeEnvironment,
  type BenchEnvironment,
} from './benchTiming'
import type { DemoFn } from './types'
import type { AoPreset, AoResolution } from '../render/gfx/ao/AmbientOcclusion'

// Frame-time benchmark.
//
// One scene: `?demo=bench&scene=<name>&n=<count>` renders the scene from
// `benchScenes`, records frames for up to `&seconds=` (default 8) or `&frames=`
// (default 300), whichever comes first, and prints the result as JSON.
//
// A suite: `?demo=bench&suite=baseline` runs every case in `suites.baseline`
// one after another, each on a fresh canvas and engine, and ends with one JSON
// report holding the environment and every result, with buttons to copy or
// download it. `&only=<text>` keeps the cases whose label contains the text.
// `&skip=<text>` drops the cases whose label contains the text. `&warmup=<frames>`
// replaces the default warmup of 60 frames and 1 second. A case that gets no
// frame for 10 seconds is recorded as stalled and the suite moves on.
//
// A single scene also ends with the report, with the same copy and download
// buttons. Add `&adaptive` to leave the engine's adaptive quality on, to see the
// steps it takes on a weak GPU. They are listed in `qualityChanges`. Otherwise
// it is off, so the case measures one fixed quality.
//
// A single scene also reads quality overrides from the URL, applied after the
// scene's own setup: `&ao=off|low|medium|high`, `&aoRes=full|half`,
// `&shadows=off|1|4|9|16` (PCF taps), `&shadowMap=256..4096` and `&scale=`
// (render scale). Every result lists the quality it ran at under `quality`.
// `?demo=bench&suite=paint` runs the card scene drawn directly, painted once
// into pictures and replayed, and painted again every frame.
// `?demo=bench&suite=costs3d` runs the boxes3d scene once per setting, each
// lowered on its own from the scene's default, to measure what each costs.
//
// Both modes read `?gfx=webgpu` (default WebGL2) and `?msaa=`. A case can fix
// its own sample count. `&present=copy` draws the frame in a target of its own
// and copies it to the canvas, to compare against the default of resolving
// straight into the canvas. Add `&marks` to record User Timing markers for the
// Firefox Profiler (frame phases, `lottie evaluate`, `lottie record`,
// `gfx submit`, one span per offscreen surface).
//
// Frame times include waiting for the display, so a scene that keeps up
// reports the refresh interval (the `idle` case measures it). `jsMs` is the
// engine's main-thread time per frame. It includes time spent blocked inside
// GL or WebGPU calls, so a GPU-bound frame can show up there. `gpuMs` is
// per-frame GPU time where the browser exposes a WebGL2 timer query (see
// `benchTiming.ts`). `&label=<name>` names the machine in the report.

/** How long a case may go without a frame before it counts as stalled. */
const STALL_MS = 10_000

/** Quality overrides a case applies after its scene's own setup. */
interface BenchQuality {
  ao?: 'off' | AoPreset
  aoRes?: AoResolution
  /** PCF taps, or `'off'` for no shadows. */
  shadows?: 'off' | number
  shadowMap?: number
  scale?: number
}

interface BenchCase {
  scene: string
  n?: number
  file?: string
  msaa?: number
  quality?: BenchQuality
}

/** The boxes3d scene with one quality setting lowered, for `costs3d`. */
function boxes(msaa?: number, quality?: BenchQuality): BenchCase {
  return { scene: 'boxes3d', n: 6, msaa, quality }
}

const suites: Record<string, BenchCase[]> = {
  baseline: [
    { scene: 'idle' },
    { scene: 'rects', n: 500 },
    { scene: 'rects', n: 2000 },
    { scene: 'circles', n: 2000 },
    { scene: 'circles', n: 10000 },
    { scene: 'labels', n: 300 },
    { scene: 'labels-zoom', n: 300 },
    { scene: 'images', n: 300 },
    { scene: 'cards', n: 12 },
    { scene: 'cards', n: 48 },
    { scene: 'grid', n: 160 },
    { scene: 'lottie-grid', n: 50, file: 'abstract_circle' },
    { scene: 'lottie-hero', file: 'isometric' },
    { scene: 'fill', n: 4 },
    { scene: 'fill', n: 16 },
    { scene: 'fill', n: 16, msaa: 1 },
    { scene: 'fill', n: 48 },
    { scene: 'boxes3d', n: 6 },
    { scene: 'boxes3d', n: 12 },
  ],
  // The scene's default is MSAA 4, AO medium at full resolution, 9-tap
  // shadows at 2048 and render scale 1. Each case lowers one of them.
  // Recording a picture against drawing straight into the renderer, on the same
  // cards: drawn directly, recorded once and replayed, and recorded every frame.
  paint: [
    { scene: 'cards', n: 48 },
    { scene: 'cards-paint', n: 48 },
    { scene: 'cards-repaint', n: 48 },
    { scene: 'panels', n: 13 },
    { scene: 'panels-paint', n: 13 },
    { scene: 'zoom', n: 48 },
    { scene: 'zoom-paint', n: 48 },
  ],
  // A layer that never changes, with and without keeping its render, and with
  // 500 rects to show what the check that nothing changed costs at rest.
  layers: [
    { scene: 'layer-blur', n: 64 },
    { scene: 'layer-blur-cached', n: 64 },
    { scene: 'layer-plain', n: 500 },
    { scene: 'layer-plain-cached', n: 500 },
    { scene: 'layer-blur', n: 500 },
    { scene: 'layer-blur-cached', n: 500 },
  ],
  costs3d: [
    boxes(4),
    boxes(2),
    boxes(1),
    boxes(4, { ao: 'low' }),
    boxes(4, { aoRes: 'half' }),
    boxes(4, { ao: 'off' }),
    boxes(4, { shadows: 4 }),
    boxes(4, { shadows: 1 }),
    boxes(4, { shadowMap: 1024 }),
    boxes(4, { shadowMap: 512 }),
    boxes(4, { shadows: 'off' }),
    boxes(4, { scale: 0.75 }),
    boxes(4, { scale: 0.5 }),
    boxes(1, { ao: 'off', shadows: 'off', scale: 0.5 }),
  ],
}

/** Reads quality overrides from the URL, see the header. */
function qualityFromUrl(params: URLSearchParams): BenchQuality | undefined {
  const q: BenchQuality = {}
  const ao = params.get('ao')
  if (ao === 'off' || ao === 'low' || ao === 'medium' || ao === 'high') {
    q.ao = ao
  }
  const aoRes = params.get('aoRes')
  if (aoRes === 'full' || aoRes === 'half') q.aoRes = aoRes
  const shadows = params.get('shadows')
  if (shadows !== null) q.shadows = shadows === 'off' ? 'off' : Number(shadows)
  if (params.has('shadowMap')) q.shadowMap = Number(params.get('shadowMap'))
  if (params.has('scale')) q.scale = Number(params.get('scale'))
  return Object.keys(q).length > 0 ? q : undefined
}

function applyQuality(host: EngineHost, q: BenchQuality): void {
  const engine = host.engine
  if (q.ao === 'off') engine.ambientOcclusion.enabled = false
  else if (q.ao) {
    engine.ambientOcclusion.enabled = true
    engine.ambientOcclusion.preset = q.ao
  }
  if (q.aoRes) engine.ambientOcclusion.resolution = q.aoRes
  if (q.shadows === 'off') engine.quality.meshShadowsEnabled = false
  else if (q.shadows !== undefined) {
    engine.quality.meshShadowsEnabled = true
    engine.quality.shadowSoftness = q.shadows
  }
  if (q.shadowMap !== undefined) engine.quality.shadowMapSize = q.shadowMap
  if (q.scale !== undefined) engine.primaryStage.renderScale = q.scale
}

/** The quality a case ran at, read back from the engine. */
function describeQuality(host: EngineHost): Record<string, unknown> {
  const engine = host.engine
  const stage = engine.primaryStage
  const ao = stage.peekAmbientOcclusion()
  return {
    msaa: stage.getMsaaSamples(),
    scale: stage.renderScale,
    ao: ao?.enabled ? ao.preset : 'off',
    aoRes: ao?.enabled ? ao.resolution : null,
    shadows: engine.quality.meshShadowsEnabled
      ? engine.quality.shadowSoftness
      : 'off',
    shadowMap: engine.quality.shadowMapSize,
  }
}

function caseLabel(c: BenchCase): string {
  let label = c.scene
  if (c.n !== undefined) label += ` n=${c.n}`
  if (c.file) label += ` ${c.file}`
  if (c.msaa !== undefined) label += ` msaa=${c.msaa}`
  for (const [key, value] of Object.entries(c.quality ?? {})) {
    label += ` ${key}=${value}`
  }
  return label
}

function percentile(sorted: number[], p: number): number {
  if (sorted.length === 0) return 0
  const i = Math.min(sorted.length - 1, Math.floor(sorted.length * p))
  return sorted[i]
}

interface Summary {
  p50: number
  p95: number
  p99: number
}

function summarize(values: number[]): Summary | null {
  if (values.length === 0) return null
  const sorted = [...values].sort((a, b) => a - b)
  const round = (v: number): number => Math.round(v * 100) / 100
  return {
    p50: round(percentile(sorted, 0.5)),
    p95: round(percentile(sorted, 0.95)),
    p99: round(percentile(sorted, 0.99)),
  }
}

interface RunLimits {
  frames: number
  seconds: number
  warmupFrames: number
  warmupSeconds: number
}

/** Engine on a canvas, on the backend `?gfx=` asks for. */
async function createHost(
  canvas: HTMLCanvasElement,
  def: BenchScene,
  msaa: number | undefined,
  marks: boolean,
): Promise<{ host: EngineHost; fallback: string | null }> {
  const wantsWebGPU =
    new URLSearchParams(window.location.search).get('gfx') === 'webgpu'
  let gpuDevice: WebGPUDevice | undefined
  let fallback: string | null = null
  if (wantsWebGPU) {
    try {
      gpuDevice = await WebGPUDevice.create(canvas)
    } catch (err) {
      fallback = err instanceof Error ? err.message : String(err)
    }
  }
  const host = createEngineHost({
    qualityProfile: false,
    canvas,
    clearColor: '#0d1a2c',
    gpuDevice,
    msaaSamples: msaa,
    directPresent:
      new URLSearchParams(window.location.search).get('present') !== 'copy',
    ...def.host,
  })
  // A benchmark measures one quality, not whatever the engine settles on.
  host.engine.quality.adaptive = new URLSearchParams(
    window.location.search,
  ).has('adaptive')
  if (marks) host.engine.perfMarks = true
  return { host, fallback }
}

/** Runs one case on `canvas` and resolves with its result. */
async function runCase(
  canvas: HTMLCanvasElement,
  c: BenchCase,
  limits: RunLimits,
  marks: boolean,
  signal: AbortSignal,
  onHost?: (host: EngineHost) => void,
): Promise<Record<string, unknown>> {
  const def = benchScenes[c.scene]
  if (!def) throw new Error(`bench: unknown scene '${c.scene}'`)
  const n = c.n ?? 1000
  lottieChoice.file = c.file
  const { host, fallback } = await createHost(canvas, def, c.msaa, marks)
  onHost?.(host)
  const qualityChanges: unknown[] = []
  const offQuality = host.events.on('qualitychange', (e) =>
    qualityChanges.push({
      ...e,
      atSeconds: Math.round(performance.now() / 100) / 10,
    }),
  )
  try {
    await host.loadScene((scene) => {
      if (def.camera2D !== false) addBenchCamera(scene)
      def.build(scene, n, canvas)
    })
    def.after?.(host)
    if (c.quality) applyQuality(host, c.quality)
    const gpuTimer = createGpuFrameTimer(host.engine, canvas)
    const frameMs: number[] = []
    const jsMs: number[] = []
    const heapDeltas: number[] = []
    const draws: number[] = []
    const memory = (
      performance as Performance & { memory?: { usedJSHeapSize: number } }
    ).memory
    let lastHeap = 0
    let lastT = 0
    let phase: 'warmup' | 'measure' = 'warmup'
    let phaseStart = performance.now()
    let warmed = 0
    let labelBase = host.engine.primaryStage.gpuStats

    const result = await new Promise<Record<string, unknown>>((resolve) => {
      let lastFrameAt = performance.now()
      // A case whose frames stop arriving (a hung GPU or a stuck browser
      // compositor) is recorded as stalled so the suite can go on.
      const watchdog = setInterval(() => {
        if (performance.now() - lastFrameAt < STALL_MS) return
        clearInterval(watchdog)
        off()
        resolve({
          case: caseLabel(c),
          error: `stalled: no frame for ${STALL_MS / 1000} s during ${phase}`,
          framesBeforeStall: warmed + frameMs.length,
        })
      }, 1000)
      const finish = (): void => {
        clearInterval(watchdog)
        off()
        gpuTimer.recording = false
        const gpu = { ...host.engine.primaryStage.gpuStats }
        const seconds = (performance.now() - phaseStart) / 1000
        resolve({
          case: caseLabel(c),
          backend: host.engine.primaryStage.backend,
          webgpuFallback: fallback,
          quality: describeQuality(host),
          samples: gpu.msaaSamples,
          pixels: `${canvas.width}x${canvas.height}`,
          frames: frameMs.length,
          seconds: Math.round(seconds * 100) / 100,
          fps: Math.round((frameMs.length / seconds) * 10) / 10,
          frameMs: summarize(frameMs),
          jsMs: summarize(jsMs),
          gpuKind: gpuTimer.kind,
          gpuMs: summarize(gpuTimer.samples),
          // Heap growth between frames. Garbage collection shows as a zero.
          heapBytesPerFrameP95: summarize(heapDeltas)?.p95 ?? null,
          // Draws vary per frame in animated scenes, so the mean and maximum
          // over the measured frames stand beside the last frame's count.
          drawCalls: gpu.drawCalls,
          drawCallsMean:
            draws.length > 0
              ? Math.round(draws.reduce((a, b) => a + b, 0) / draws.length)
              : 0,
          drawCallsMax: draws.reduce((a, b) => Math.max(a, b), 0),
          uboSlices: gpu.uboSlices,
          bytesUploaded: gpu.bytesUploaded,
          programSwitches: gpu.programSwitches,
          textureBinds: gpu.textureBinds,
          passCount: gpu.passCount,
          runsMerged: gpu.runsMerged,
          primitives: gpu.primitives,
          picturesPainted: host.engine.primaryStage.composeStats.paints,
          picturesReplayed: host.engine.primaryStage.composeStats.replays,
          framePasses: gpu.framePasses,
          frameSubmits: gpu.frameSubmits,
          frameBindGroupsCreated: gpu.frameBindGroupsCreated,
          frameBindGroupSwitches: gpu.frameBindGroupSwitches,
          frameUniformWrites: gpu.frameUniformWrites,
          surfaces: gpu.surfaces,
          offscreenBytes: gpu.offscreenBytes,
          // Label work over the measured frames. Rasters and wipes mean text was
          // rebuilt instead of reused.
          labelRasters: gpu.labelRasters - labelBase.labelRasters,
          labelUploadBytes: gpu.labelUploadBytes - labelBase.labelUploadBytes,
          labelDedicated: gpu.labelDedicated - labelBase.labelDedicated,
          labelHolds: gpu.labelHolds - labelBase.labelHolds,
          labelPageWipes: gpu.labelPageWipes - labelBase.labelPageWipes,
          qualityChanges,
          meshDraws: host.engine.primaryStage.render3dStats?.draws ?? 0,
          meshTriangles: host.engine.primaryStage.render3dStats?.triangles ?? 0,
          shadowPasses:
            host.engine.primaryStage.render3dStats?.shadowPasses ?? 0,
          // A scene with content that recorded no draws did not render, for
          // example because a pipeline failed to compile. Its timings are void.
          warning:
            c.scene !== 'idle' &&
            gpu.drawCalls === 0 &&
            (host.engine.primaryStage.render3dStats?.draws ?? 0) === 0
              ? 'nothing drawn'
              : null,
        })
      }
      const off = host.events.on('frame', () => {
        const now = performance.now()
        lastFrameAt = now
        if (signal.aborted) {
          clearInterval(watchdog)
          off()
          resolve({ case: caseLabel(c), aborted: true })
          return
        }
        if (phase === 'warmup') {
          warmed++
          if (
            warmed >= limits.warmupFrames &&
            now - phaseStart >= limits.warmupSeconds * 1000
          ) {
            phase = 'measure'
            phaseStart = now
            labelBase = { ...host.engine.primaryStage.gpuStats }
            lastT = now
            lastHeap = memory?.usedJSHeapSize ?? 0
            gpuTimer.recording = true
          }
          return
        }
        frameMs.push(now - lastT)
        lastT = now
        jsMs.push(host.engine.lastFrameWorkSec * 1000)
        draws.push(host.engine.primaryStage.gpuStats.drawCalls)
        const heap = memory?.usedJSHeapSize ?? 0
        heapDeltas.push(Math.max(0, heap - lastHeap))
        lastHeap = heap
        const elapsed = (now - phaseStart) / 1000
        const enough =
          frameMs.length >= limits.frames || elapsed >= limits.seconds
        if (enough && frameMs.length >= Math.min(20, limits.frames)) finish()
      })
      host.start()
    })
    gpuTimer.dispose()
    if (new URLSearchParams(window.location.search).has('verifymerge')) {
      result.mergeDiffPixels = countMergeDiff(host, canvas)
    }
    return result
  } finally {
    offQuality()
    host.destroy()
  }
}

/**
 * Renders the scene's current frame twice, with draws joined and without, and
 * returns how many pixels differ. Anything above zero means joining changed the
 * picture.
 */
function countMergeDiff(
  host: ReturnType<typeof createEngineHost>,
  canvas: HTMLCanvasElement,
): number {
  const stage = host.engine.primaryStage
  const grab = (): Uint8ClampedArray => {
    stage.render(0)
    const copy = document.createElement('canvas')
    copy.width = canvas.width
    copy.height = canvas.height
    const g = copy.getContext('2d', { willReadFrequently: true })!
    g.drawImage(canvas, 0, 0)
    return g.getImageData(0, 0, copy.width, copy.height).data
  }
  stage.mergeRuns = true
  const joined = grab()
  stage.mergeRuns = false
  const separate = grab()
  stage.mergeRuns = true
  let differing = 0
  for (let i = 0; i < joined.length; i += 4) {
    if (
      joined[i] !== separate[i] ||
      joined[i + 1] !== separate[i + 1] ||
      joined[i + 2] !== separate[i + 2] ||
      joined[i + 3] !== separate[i + 3]
    ) {
      differing++
    }
  }
  return differing
}

/** A fixed overlay that shows progress, then the report with copy and download. */
function createReportBox(): {
  el: HTMLElement
  status(text: string): void
  report(json: string, filename: string): void
} {
  const el = document.createElement('div')
  el.style.cssText =
    'position:fixed;left:12px;top:12px;max-width:min(720px,calc(100vw - 24px));max-height:calc(100vh - 120px);overflow:auto;padding:10px;background:rgba(10,12,18,.92);color:#fff;font:12px/1.4 monospace;z-index:400;border-radius:6px'
  const text = document.createElement('pre')
  text.style.cssText = 'margin:0;white-space:pre-wrap'
  el.appendChild(text)
  document.body.appendChild(el)
  return {
    el,
    status(t) {
      text.textContent = t
    },
    report(json, filename) {
      text.textContent = ''
      const bar = document.createElement('div')
      bar.style.cssText = 'display:flex;gap:8px;margin-bottom:8px'
      const copy = document.createElement('button')
      copy.textContent = 'Copy JSON'
      copy.onclick = () => {
        void navigator.clipboard?.writeText(json).then(
          () => (copy.textContent = 'Copied'),
          () => {
            const range = document.createRange()
            range.selectNodeContents(text)
            getSelection()?.removeAllRanges()
            getSelection()?.addRange(range)
            copy.textContent = 'Selected, press Ctrl+C'
          },
        )
      }
      const save = document.createElement('button')
      save.textContent = 'Download'
      save.onclick = () => {
        const url = URL.createObjectURL(
          new Blob([json], { type: 'application/json' }),
        )
        const a = document.createElement('a')
        a.href = url
        a.download = filename
        a.click()
        URL.revokeObjectURL(url)
      }
      bar.append(copy, save)
      el.insertBefore(bar, text)
      text.textContent = json
    },
  }
}

function browserName(ua: string): string {
  if (/Firefox\//.test(ua)) return 'firefox'
  if (/Edg\//.test(ua)) return 'edge'
  if (/Chrome\//.test(ua)) return 'chrome'
  if (/Safari\//.test(ua)) return 'safari'
  return 'browser'
}

/** A fresh canvas in place of `old`, since a WebGPU canvas can't be reused. */
function replaceCanvas(old: HTMLCanvasElement): HTMLCanvasElement {
  const next = old.cloneNode(false) as HTMLCanvasElement
  old.replaceWith(next)
  return next
}

const runBench: DemoFn = async ({ canvas, signal, attach }) => {
  const params = new URLSearchParams(window.location.search)
  const marks = params.has('marks')
  const suiteName = params.get('suite')
  const box = createReportBox()
  let current: HTMLCanvasElement = canvas
  const limits: RunLimits = {
    frames: Number(params.get('frames') ?? 300),
    seconds: Number(params.get('seconds') ?? 8),
    warmupFrames: Number(params.get('warmup') ?? 60),
    warmupSeconds: params.has('warmup') ? 0 : 1,
  }

  const run = async (): Promise<void> => {
    if (!suiteName) {
      const c: BenchCase = {
        scene: params.get('scene') ?? 'rects',
        n: params.has('n') ? Number(params.get('n')) : undefined,
        file: params.get('file') ?? undefined,
        quality: qualityFromUrl(params),
      }
      box.status(`bench ${caseLabel(c)}: running`)
      const result = await runCase(current, c, limits, marks, signal, attach)
      const started = new Date()
      const text = JSON.stringify(
        {
          scene: caseLabel(c),
          started: started.toISOString(),
          url: window.location.href,
          environment: await describeEnvironment(),
          result,
        },
        null,
        2,
      )
      console.info(`[bench] ${text}`)
      const backend = params.get('gfx') === 'webgpu' ? 'webgpu' : 'webgl2'
      const stamp = started.toISOString().slice(0, 16).replace(/[:T]/g, '-')
      box.report(
        text,
        `bench-${c.scene}-${browserName(navigator.userAgent)}-${backend}-${stamp}.json`,
      )
      return
    }
    const suite = suites[suiteName]
    if (!suite) throw new Error(`bench: unknown suite '${suiteName}'`)
    const only = params.get('only')
    const skip = params.get('skip')
    const cases = suite.filter(
      (c) =>
        (!only || caseLabel(c).includes(only)) &&
        (!skip || !caseLabel(c).includes(skip)),
    )
    const environment: BenchEnvironment = await describeEnvironment()
    const results: Record<string, unknown>[] = []
    const started = new Date()
    for (let i = 0; i < cases.length; i++) {
      if (signal.aborted) return
      const c = cases[i]
      box.status(
        `suite ${suiteName}: case ${i + 1} of ${cases.length}, ${caseLabel(c)}\n` +
          'Keep this window visible and in front until the report appears.',
      )
      if (i > 0) current = replaceCanvas(current)
      try {
        const result = await runCase(current, c, limits, marks, signal)
        console.info(`[bench] ${JSON.stringify(result)}`)
        results.push(result)
      } catch (err) {
        results.push({
          case: caseLabel(c),
          error: err instanceof Error ? err.message : String(err),
        })
      }
    }
    const report = {
      suite: suiteName,
      started: started.toISOString(),
      url: window.location.href,
      environment,
      results,
    }
    const json = JSON.stringify(report, null, 2)
    console.info(`[bench] ${json}`)
    const backend = params.get('gfx') === 'webgpu' ? 'webgpu' : 'webgl2'
    const stamp = started.toISOString().slice(0, 16).replace(/[:T]/g, '-')
    box.report(
      json,
      `bench-${suiteName}-${browserName(navigator.userAgent)}-${backend}-${stamp}.json`,
    )
  }

  run().catch((err: unknown) => {
    box.status(
      `bench failed: ${err instanceof Error ? err.message : String(err)}`,
    )
  })

  const stop = (): void => {
    box.el.remove()
    // Hand the original canvas back so the demo stage can remove it.
    if (current !== canvas) current.replaceWith(canvas)
  }
  signal.addEventListener('abort', stop, { once: true })
  return stop
}

export default runBench
