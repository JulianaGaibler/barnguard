import { Engine, type EngineOptions } from './Engine'
import type { Emitter } from '../events/Emitter'
import type { EngineEvents } from '../events/EngineEvents'
import type { Scene } from '../scene/Scene'
import { DebugController } from '../debug/DebugController'

/**
 * Construction options for {@link createEngineHost}. Extends
 * {@link EngineOptions} but takes its own `renderer` and context-loss handlers.
 *
 * @category Engine
 */
export interface EngineHostOptions extends Omit<
  EngineOptions,
  'canvas' | 'renderer'
> {
  canvas: HTMLCanvasElement
  /**
   * Called when the canvas loses its 2D context. Default is
   * `location.reload()`. Apps that don't want a page reload should override
   * this and manage the rebuild themselves.
   */
  onContextLost?: (restorable: boolean) => void
  /**
   * Boot-time HUD state override. If omitted, reads from `?debug` in
   * `window.location.search`: `?debug=hud` → HUD visible on boot `?debug=perf`
   * → HUD visible on boot + per-node `performance.mark()` timing enabled on the
   * engine (inspect via DevTools User Timing lane) (absent / anything else) →
   * HUD hidden on boot
   *
   * The DebugController is ALWAYS instantiated, the URL flag only controls its
   * initial visibility. External code (a menu or admin panel) toggles the HUD
   * at runtime via `host.debug.setHudVisible`.
   */
  debug?: 'hidden' | 'hud' | 'perf'
  /**
   * Renderer backend for the primary stage. Default `'auto'` uses GPU (WebGL2)
   * unless `?renderer=canvas2d` is present in `window.location.search`.
   * Explicit values (`'canvas2d'` / `'gpu'`) skip the URL probe, useful for
   * tests and hard-wired deployments.
   */
  renderer?: 'canvas2d' | 'gpu' | 'auto'
  /**
   * Fallback triggered when the retry ladder decides recovery isn't feasible
   * (≥3 context losses within 60 s, or the browser signaled the loss is
   * unrestorable). Default: `() => window.location.reload()`. Tests inject a
   * stub to observe the trigger without actually reloading; deployments can
   * wire it to a supervisor.
   */
  onReload?: () => void
}

/**
 * Populates a fresh {@link Scene}. Passed to {@link EngineHost.loadScene}, which
 * destroys the current scene's contents before calling it. Add root nodes
 * through `scene.root`; reach shared services (input, animation, camera)
 * through `engine`. May be async, so it can await asset loads before building
 * the tree.
 *
 * @category Engine
 * @example
 *   const build: SceneBuilder = (scene) => {
 *     scene.root.add(
 *       new ShapeNode({
 *         geometry: { kind: 'circle', radius: 40 },
 *         fill: '#fff',
 *       }),
 *     )
 *   }
 */
export type SceneBuilder = (
  scene: Scene,
  engine: Engine,
) => void | Promise<void>

/**
 * Owns an {@link Engine} plus the lifecycle concerns a page needs around it:
 * start/stop, pause/resume, scene swapping, and WebGL context-loss recovery.
 * Mount one host per canvas. Inside a Svelte component, prefer the
 * `mountEngine` action, which builds the host and wires resize and teardown for
 * you.
 *
 * Build one with {@link createEngineHost}.
 *
 * @category Engine
 */
export interface EngineHost {
  /** The wrapped engine. Reach scene, camera, input, and animation through it. */
  readonly engine: Engine
  /** The engine's event bus (`ready`, `frame`, `resize`, `contextlost`, …). */
  readonly events: Emitter<EngineEvents>
  /** True between {@link EngineHost.pause} and {@link EngineHost.resume}. */
  readonly paused: boolean
  /**
   * The debug controller. Always present so an external menu can toggle the HUD
   * at runtime; the `?debug` URL flag only decides whether it starts open.
   */
  readonly debug: DebugController
  /** Start the render loop. The first call also emits the `ready` event. */
  start(): void
  /** Stop the render loop. The scene and GL resources stay intact. */
  stop(): void
  /**
   * Pause for a full-screen overlay covering the canvas. This stops the ticker
   * outright, unlike {@link Engine.paused}, a soft freeze that keeps the ticker
   * running so debug tools stay live. Resume with {@link EngineHost.resume}.
   */
  pause(): void
  /** Resume after {@link EngineHost.pause}. */
  resume(): void
  /**
   * Tear down the engine: stop the loop, remove context-loss listeners, and
   * reject every pending tween/wait with `AbortError`.
   */
  destroy(): void
  /**
   * Swap the scene. Destroys every current root child, then calls `build` to
   * populate the emptied scene. Await it, `build` may load assets before it
   * returns.
   */
  loadScene(build: SceneBuilder): Promise<void>
}

interface ContextLostEvent extends Event {
  readonly canBeRestored?: boolean
}

function resolveDebugMode(
  explicit?: 'hidden' | 'hud' | 'perf',
): 'hidden' | 'hud' | 'perf' {
  if (explicit) return explicit
  if (typeof window === 'undefined') return 'hidden'
  const raw = new URLSearchParams(window.location.search).get('debug')
  if (raw === 'hud') return 'hud'
  if (raw === 'perf') return 'perf'
  return 'hidden'
}

/**
 * Explicit option wins. Otherwise the URL flag: `?renderer=canvas2d` opts out
 * to Canvas 2D. Default is GPU (WebGL2). SSR / no-window environments (tests)
 * get Canvas. WebGL2 needs a live context.
 */
function resolveRendererMode(
  explicit?: 'canvas2d' | 'gpu' | 'auto',
): 'canvas2d' | 'gpu' {
  if (explicit === 'canvas2d' || explicit === 'gpu') return explicit
  if (typeof window === 'undefined') return 'canvas2d'
  const raw = new URLSearchParams(window.location.search).get('renderer')
  if (raw === 'canvas2d') return 'canvas2d'
  return 'gpu'
}

/**
 * Resolve MSAA sample count: explicit option wins; otherwise read `?msaa=N`
 * from the URL. Accepts `0` (off), `2`, `4`, `8`. Default `4`. WebGL2 minimum
 * universally supported and gives visible fill- edge AA without unreasonable
 * bandwidth cost.
 */
export function resolveMsaaSamples(explicit?: number): number {
  if (
    typeof explicit === 'number' &&
    Number.isFinite(explicit) &&
    explicit >= 0
  ) {
    return Math.floor(explicit)
  }
  if (typeof window === 'undefined') return 4
  const raw = new URLSearchParams(window.location.search).get('msaa')
  if (raw === null) return 4
  const parsed = Number.parseInt(raw, 10)
  if (Number.isFinite(parsed) && parsed >= 0) return parsed
  return 4
}

/**
 * Build an {@link EngineHost} around a canvas: construct the {@link Engine},
 * attach a {@link DebugController}, and register WebGL context-loss recovery.
 *
 * The renderer backend, MSAA sample count, and debug HUD state resolve from
 * `opts` first, then fall back to URL flags (`?renderer=`, `?msaa=`, `?debug=`)
 * so a deployed build can be probed without a code change. See
 * {@link EngineHostOptions} for the per-field precedence.
 *
 * @category Engine
 * @example
 *   const host = createEngineHost({
 *     canvas,
 *     clearColor: '#0d1a2c',
 *     initialViewport: { x: 0, y: 0, width: 1920, height: 1080 },
 *   })
 *   await host.loadScene((scene) => {
 *     scene.root.add(
 *       new ShapeNode({
 *         geometry: { kind: 'circle', radius: 40 },
 *         fill: '#fff',
 *       }),
 *     )
 *   })
 *   host.start()
 */
export function createEngineHost(opts: EngineHostOptions): EngineHost {
  const rendererMode = resolveRendererMode(opts.renderer)
  const msaaSamples = resolveMsaaSamples(opts.msaaSamples)
  const engine = new Engine({
    ...opts,
    renderer: rendererMode,
    msaaSamples,
  })

  const debugMode = resolveDebugMode(opts.debug)
  // Always instantiate, booth-side surfaces (menu, game-rules window)
  // rely on `host.debug` being non-null so they can toggle HUD state at
  // runtime. The URL flag only decides whether the HUD starts open.
  const debug = new DebugController(engine, {
    showHud: debugMode === 'hud' || debugMode === 'perf',
  })
  engine.debug = debug
  if (debugMode === 'perf') engine.perfMarks = true

  // Retry ladder: track the timestamps of recent context losses; if we
  // hit ≥3 in a rolling 60-second window (or the browser flags the loss
  // as unrestorable), abandon in-place recovery and fire `onReload`. The
  // ring buffer holds at most 3 entries, evict entries older than the
  // window on each new loss.
  const LOSS_WINDOW_MS = 60_000
  const MAX_LOSSES_IN_WINDOW = 3
  const lossTimestamps: number[] = []
  const onReload = opts.onReload ?? (() => window.location.reload())

  const onContextLost = (e: Event): void => {
    const restorable = (e as ContextLostEvent).canBeRestored ?? true
    e.preventDefault()
    engine.events.emit('contextlost', { restorable })
    // Record + evict.
    const now = performance.now()
    while (lossTimestamps.length && lossTimestamps[0] < now - LOSS_WINDOW_MS) {
      lossTimestamps.shift()
    }
    lossTimestamps.push(now)
    const overThreshold = lossTimestamps.length >= MAX_LOSSES_IN_WINDOW
    if (!restorable || overThreshold) {
      if (opts.onContextLost) {
        opts.onContextLost(restorable)
      } else {
        onReload()
      }
    }
    // Otherwise wait for `webglcontextrestored`. Stage handles rebuild.
  }
  const onContextRestored = (): void => {
    engine.primaryStage.reacquireContext()
    engine.events.emit('contextrestored', undefined)
  }

  // Both event pairs, only the relevant one for the active backend fires.
  // `contextlost`/`contextrestored` cover the 2D backend; `webglcontextlost`
  // /`webglcontextrestored` cover the WebGL2 backend.
  opts.canvas.addEventListener('contextlost', onContextLost)
  opts.canvas.addEventListener('contextrestored', onContextRestored)
  opts.canvas.addEventListener('webglcontextlost', onContextLost)
  opts.canvas.addEventListener('webglcontextrestored', onContextRestored)

  let paused = false
  let destroyed = false

  const host: EngineHost = {
    engine,
    events: engine.events,
    debug,
    get paused() {
      return paused
    },
    start() {
      if (destroyed) return
      paused = false
      engine.start()
    },
    stop() {
      if (destroyed) return
      engine.stop()
    },
    pause() {
      if (destroyed || paused) return
      paused = true
      engine.stop()
    },
    resume() {
      if (destroyed || !paused) return
      paused = false
      engine.start()
    },
    destroy() {
      if (destroyed) return
      destroyed = true
      opts.canvas.removeEventListener('contextlost', onContextLost)
      opts.canvas.removeEventListener('contextrestored', onContextRestored)
      opts.canvas.removeEventListener('webglcontextlost', onContextLost)
      opts.canvas.removeEventListener('webglcontextrestored', onContextRestored)
      engine.destroy()
    },
    async loadScene(build) {
      const existing = engine.scene.root.children.slice()
      for (const child of existing) child.destroy()
      await build(engine.scene, engine)
    },
  }

  return host
}
