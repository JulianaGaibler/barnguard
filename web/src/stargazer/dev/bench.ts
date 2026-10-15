import { createEngineHost } from '../engine/EngineHost'
import { addDemoCamera } from './demoCamera'
import { Node2D } from '../scene/Node2D'
import { ShapeNode } from '../nodes/ShapeNode'
import { LottieNode } from '../nodes/LottieNode'
import { parseLottie } from '../lottie/model/parse'
import type { LottieAnimation } from '../lottie/model/types'
import type { Gfx2D } from '../render/gfx/Gfx2D'
import type { SceneTree } from '../scene/SceneTree'
import type { DemoFn } from './types'

// Frame-time benchmark. `?demo=bench&scene=<name>&frames=600&n=<count>` renders
// the named scene, records every frame, and prints percentiles as JSON to the
// console and to an on-screen box. Add a scene by registering a builder in
// `benchScenes`. Run it with `?gfx=webgl2` and `?gfx=webgpu`, and `?msaa=4`,
// on a 4K display for the numbers the performance gates refer to.
//
// Add `&marks` to record User Timing markers for the Firefox Profiler: frame
// phases, `lottie evaluate`, `lottie record`, `gfx submit`, one span per
// offscreen surface and a `gfx-stats` marker with the frame's counters. The
// spans measure the time JavaScript spends issuing work. GPU time is not in them.
//
// Lottie scenes read `&file=<fixture>` (default `isometric`):
//   lottie-hero     one animation fitted to the whole view
//   lottie-grid     `n` synced copies
//   lottie-stagger  `n` copies, each starting at a different frame
//   lottie-mixed    `n` animations cycling through every fixture

/** Builds one benchmark scene. `n` is the scene's size knob. */
export type BenchScene = (scene: SceneTree, n: number) => void

/** A `#rrggbb` color at `deg` degrees of hue, the form `parseColor` accepts. */
function hue(deg: number): string {
  const h = (((deg % 360) + 360) % 360) / 60
  const x = 1 - Math.abs((h % 2) - 1)
  const [r, g, b] =
    h < 1
      ? [1, x, 0]
      : h < 2
        ? [x, 1, 0]
        : h < 3
          ? [0, 1, x]
          : h < 4
            ? [0, x, 1]
            : h < 5
              ? [x, 0, 1]
              : [1, 0, x]
  const hex = (v: number): string =>
    Math.round(60 + v * 160)
      .toString(16)
      .padStart(2, '0')
  return `#${hex(r)}${hex(g)}${hex(b)}`
}

class BlendRect extends Node2D {
  readonly color: string
  readonly additive: boolean
  constructor(color: string, additive: boolean) {
    super()
    this.color = color
    this.additive = additive
  }
  override draw(gfx: Gfx2D): void {
    gfx.setBlend(this.additive ? 'lighter' : 'source-over')
    gfx.fillRect(0, 0, 12, 12, this.color)
  }
}

export const benchScenes: Record<string, BenchScene> = {
  // Many small fills, alternating blend so every fill is its own draw run with
  // its own uniform slice.
  rects: (scene, n) => {
    for (let i = 0; i < n; i++) {
      const node = new BlendRect(hue(i * 37), i % 2 === 1)
      node.transform.x = (i % 100) * 18
      node.transform.y = Math.floor(i / 100) * 18
      scene.root.add(node)
    }
  },
  // Many small circles in one batch.
  circles: (scene, n) => {
    for (let i = 0; i < n; i++) {
      const node = new ShapeNode({
        geometry: { kind: 'circle', radius: 6 },
        fill: hue(i * 53),
      })
      node.transform.x = (i % 100) * 18 + 9
      node.transform.y = Math.floor(i / 100) * 18 + 9
      scene.root.add(node)
    }
  },
}

const lottieFixtures = import.meta.glob('./fixtures/lottie/*.json', {
  eager: true,
  query: '?raw',
  import: 'default',
}) as Record<string, string>

const lottieCache = new Map<string, LottieAnimation>()
function lottieFixture(path: string): LottieAnimation {
  let anim = lottieCache.get(path)
  if (!anim) {
    anim = parseLottie(lottieFixtures[path])
    lottieCache.set(path, anim)
  }
  return anim
}

function lottieFile(): string {
  const name =
    new URLSearchParams(window.location.search).get('file') ?? 'isometric'
  const path = `./fixtures/lottie/${name}.json`
  if (!(path in lottieFixtures))
    throw new Error(`bench: unknown file '${name}'`)
  return path
}

/** Tile `n` animations over the 1920 x 1080 view. */
function lottieTiles(
  scene: SceneTree,
  n: number,
  pick: (i: number) => string,
  stagger: boolean,
): void {
  const cols = Math.max(1, Math.ceil(Math.sqrt((n * 1920) / 1080)))
  const rows = Math.ceil(n / cols)
  const cell = Math.min(1920 / cols, 1080 / rows)
  for (let i = 0; i < n; i++) {
    const anim = lottieFixture(pick(i))
    const node = new LottieNode({
      animation: anim,
      width: cell,
      height: cell,
    })
    node.transform.x = (i % cols) * cell
    node.transform.y = Math.floor(i / cols) * cell
    if (stagger) node.seek((i * 7) % Math.max(1, anim.totalFrames - 1))
    scene.root.add(node)
  }
}

benchScenes['lottie-hero'] = (scene) => {
  const node = new LottieNode({
    animation: lottieFixture(lottieFile()),
    width: 1920,
    height: 1080,
  })
  scene.root.add(node)
}
benchScenes['lottie-grid'] = (scene, n) =>
  lottieTiles(scene, n, lottieFile, false)
benchScenes['lottie-stagger'] = (scene, n) =>
  lottieTiles(scene, n, lottieFile, true)
benchScenes['lottie-mixed'] = (scene, n) => {
  const paths = Object.keys(lottieFixtures).sort()
  lottieTiles(scene, n, (i) => paths[i % paths.length], true)
}

function percentile(sorted: number[], p: number): number {
  if (sorted.length === 0) return 0
  const i = Math.min(sorted.length - 1, Math.floor(sorted.length * p))
  return sorted[i]
}

function summarize(values: number[]): {
  p50: number
  p95: number
  p99: number
} {
  const sorted = [...values].sort((a, b) => a - b)
  const round = (v: number): number => Math.round(v * 100) / 100
  return {
    p50: round(percentile(sorted, 0.5)),
    p95: round(percentile(sorted, 0.95)),
    p99: round(percentile(sorted, 0.99)),
  }
}

const runBench: DemoFn = async ({ canvas, signal, attach }) => {
  const params = new URLSearchParams(window.location.search)
  const sceneName = params.get('scene') ?? 'rects'
  const frames = Number(params.get('frames') ?? 600)
  const n = Number(params.get('n') ?? 1000)
  const build = benchScenes[sceneName]
  if (!build) throw new Error(`bench: unknown scene '${sceneName}'`)

  const host = createEngineHost({ canvas, clearColor: '#0d1a2c' })
  attach?.(host)
  if (params.has('marks')) host.engine.perfMarks = true
  await host.loadScene((scene) => {
    addDemoCamera(scene, { x: 0, y: 0, width: 1920, height: 1080 })
    build(scene, n)
  })

  const frameMs: number[] = []
  const jsMs: number[] = []
  const heapDeltas: number[] = []
  const memory = (
    performance as Performance & { memory?: { usedJSHeapSize: number } }
  ).memory
  let lastHeap = memory?.usedJSHeapSize ?? 0
  let lastT = 0
  let warmup = 60
  let done = false

  const box = document.createElement('pre')
  box.style.cssText =
    'position:fixed;left:12px;bottom:12px;margin:0;padding:8px;background:rgba(10,12,18,.85);color:#fff;font:11px/1.4 monospace;z-index:400'
  box.textContent = `bench ${sceneName} n=${n}: warming up`
  document.body.appendChild(box)

  const off = host.events.on('frame', () => {
    const now = performance.now()
    if (warmup > 0) {
      warmup--
      lastT = now
      lastHeap = memory?.usedJSHeapSize ?? 0
      return
    }
    if (done) return
    frameMs.push(now - lastT)
    lastT = now
    jsMs.push(host.engine.lastFrameWorkSec * 1000)
    const heap = memory?.usedJSHeapSize ?? 0
    heapDeltas.push(Math.max(0, heap - lastHeap))
    lastHeap = heap
    if (frameMs.length >= frames) {
      done = true
      const gpu = { ...host.engine.primaryStage.gpuStats }
      const result = {
        scene: sceneName,
        n,
        backend: host.engine.primaryStage.backend,
        samples: gpu.msaaSamples,
        pixels: `${canvas.width}x${canvas.height}`,
        frames,
        frameMs: summarize(frameMs),
        jsMs: summarize(jsMs),
        // Heap growth between frames. Garbage collection shows as a zero.
        heapBytesPerFrameP95: summarize(heapDeltas).p95,
        drawCalls: gpu.drawCalls,
        uboSlices: gpu.uboSlices,
        bytesUploaded: gpu.bytesUploaded,
        programSwitches: gpu.programSwitches,
        passCount: gpu.passCount,
        surfaces: gpu.surfaces,
        offscreenBytes: gpu.offscreenBytes,
      }
      const text = JSON.stringify(result, null, 2)
      console.info(`[bench] ${text}`)
      box.textContent = text
    }
  })

  host.start()
  const stop = (): void => {
    off()
    box.remove()
    host.destroy()
  }
  signal.addEventListener('abort', stop, { once: true })
  return stop
}

export default runBench
