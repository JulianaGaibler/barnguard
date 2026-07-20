import type { PointerEvent2D } from '../input/PointerState'

/**
 * The event map for the engine's `Emitter` (`host.events` / `engine.events`).
 * `frame` and `pointerMove` fire every frame, don't bind them to Svelte stores;
 * `svelte/emitterStore.ts` has a dev-time guard.
 *
 * The four `pointer*` keys carry primary-stage events only. `Engine` forwards
 * them from `primaryStage.events` for convenience; a secondary `Stage` emits on
 * its own `stage.events`, so listen there for a specific canvas.
 *
 * @category Events
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
  /** The engine was destroyed. */
  destroyed: void
}
