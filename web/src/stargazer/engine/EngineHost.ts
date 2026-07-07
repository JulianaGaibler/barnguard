import { Engine, type EngineOptions } from './Engine'
import type { Emitter } from '../events/Emitter'
import type { EngineEvents } from '../events/EngineEvents'
import type { Scene } from '../scene/Scene'
import { DebugController } from '../debug/DebugController'

export interface EngineHostOptions extends Omit<
  EngineOptions,
  'canvas' | 'renderer'
> {
  canvas: HTMLCanvasElement
  /**
   * Called when the canvas loses its 2D context. Default is
   * `location.reload()`, the kiosk-safe recovery. Apps that don't want a page
   * reload should override this and manage rebuild themselves.
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
   * initial visibility. External code (a booth menu, an admin panel) toggles
   * the HUD at runtime via `host.debug.setHudVisible`.
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
   * stub to observe the trigger without actually reloading; kiosk deployments
   * can wire it to a supervisor.
   */
  onReload?: () => void
}

export type SceneBuilder = (
  scene: Scene,
  engine: Engine,
) => void | Promise<void>

export interface EngineHost {
  readonly engine: Engine
  readonly events: Emitter<EngineEvents>
  readonly paused: boolean
  /**
   * Always present, the booth menu toggles HUD visibility at runtime, so the
   * controller has to exist regardless of the URL flag.
   */
  readonly debug: DebugController
  start(): void
  stop(): void
  pause(): void
  resume(): void
  destroy(): void
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
