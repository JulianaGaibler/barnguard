import type { PointerEvent2D } from '../input/PointerState'

/**
 * The event map for the engine boundary. `frame` and `pointerMove` are HIGH
 * FREQUENCY and must not be bound to Svelte stores, see
 * `svelte/emitterStore.ts` for the dev-time guard.
 *
 * The four `pointer*` keys carry PRIMARY stage events only. `Engine` forwards
 * from `primaryStage.events` to this bus for backwards compatibility; secondary
 * stages emit only on their own `stage.events`. If you need pointer events from
 * a specific stage, listen on `stage.events.on(...)` instead.
 */
export interface EngineEvents {
  ready: { pixelSize: { w: number; h: number } }
  frame: { time: number; dt: number; frameNum: number }
  resize: {
    pixel: { w: number; h: number }
    css: { w: number; h: number }
    dpr: number
  }
  pointerDown: PointerEvent2D
  pointerMove: PointerEvent2D
  pointerUp: PointerEvent2D
  pointerCancel: PointerEvent2D
  contextlost: { restorable: boolean }
  contextrestored: void
  destroyed: void
}
