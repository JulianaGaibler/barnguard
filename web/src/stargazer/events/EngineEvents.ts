import type { PointerEvent2D } from '../input/PointerState'
import type { QualityTier } from '../render/AdaptiveQuality'
import type { AoPreset, AoResolution } from '../render/gfx/ao/AmbientOcclusion'

/**
 * The event map for the engine's `Emitter` (`host.events` / `engine.events`).
 * `frame` and `pointerMove` fire every frame, so don't bind them to Svelte
 * stores. `svelte/emitterStore.ts` has a dev-time guard.
 *
 * The four `pointer*` keys carry primary-stage events only. `Engine` forwards
 * them from `primaryStage.events` for convenience. A secondary `Stage` emits on
 * its own `stage.events`, so listen there for a specific canvas.
 *
 * @example
 *   const off = host.events.on('frame', ({ dt }) => {
 *     // per-frame work, dt in seconds
 *   })
 *   off() // unsubscribe
 */
export interface EngineEvents {
  /** Fires once, on the first `EngineHost.start`, after initial sizing. */
  ready: { pixelSize: { w: number; h: number } }
  /**
   * Fires at the end of each rendered frame. `time` is engine seconds, `dt` the
   * frame delta, `frameNum` a monotonic counter. High frequency.
   */
  frame: { time: number; dt: number; frameNum: number }
  /** Fires after the primary canvas changes CSS size or device-pixel ratio. */
  resize: {
    pixel: { w: number; h: number }
    css: { w: number; h: number }
    dpr: number
  }
  /** Primary-stage pointer press. */
  pointerDown: PointerEvent2D
  /** Primary-stage pointer move. High frequency. */
  pointerMove: PointerEvent2D
  /** Primary-stage pointer release. */
  pointerUp: PointerEvent2D
  /**
   * Primary-stage pointer cancel (capture lost, or the gesture was
   * interrupted).
   */
  pointerCancel: PointerEvent2D
  /**
   * The rendering context was lost. `restorable: false` means the browser
   * doesn't expect it back, the host's retry ladder decides whether to reload.
   */
  contextlost: { restorable: boolean }
  /** The rendering context came back and GL resources have been rebuilt. */
  contextrestored: void
  /**
   * The active backend's device was lost with no in-place recovery (a WebGPU
   * device loss). The canvas is committed to its context type, so the Svelte
   * host recovers by remounting on a fresh canvas forced to WebGL2, it does not
   * try to rebuild in place. Carries the backend that was lost.
   */
  backendlost: { backend: 'webgpu' | 'webgl2' }
  /**
   * A GPU resource could not be built, usually a shader that the browser's
   * compiler rejects. Rendering continues without it: a failed 2D program draws
   * nothing and a failed 3D renderer leaves 3D off. Fires once per distinct
   * failure.
   */
  renderfailure: { source: string; message: string }
  /**
   * The engine lowered a quality setting because the GPU could not keep up.
   * Fires once per step, and settings never step back up.
   */
  qualitychange: {
    msaa: number
    renderScale: number
    /** Shadow PCF taps, `0` with shadows off. */
    shadows: number
    /** The ambient occlusion preset, or `'off'`. */
    ao: AoPreset | 'off'
    aoResolution: AoResolution
    /** The kinds of the tiers this change applied, in order. */
    steps: QualityTier['kind'][]
    frameMs: number
  }
  /** The engine was destroyed. */
  destroyed: void
}
