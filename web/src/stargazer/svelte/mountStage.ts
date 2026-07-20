import type { Engine } from '../engine/Engine'
import type { Stage, StageOptions } from '../render/Stage'

/**
 * Params for the {@link mountStage} Svelte action.
 *
 * @category Svelte
 */
export interface MountStageParams {
  /** The primary engine that will drive this secondary stage. */
  engine: Engine
  /** Passed through to `engine.attachStage`. */
  options?: StageOptions
  /** Fires after the stage is attached, build your scene here. */
  onReady?: (stage: Stage) => void | Promise<void>
  /** Fires before the stage is disposed on unmount. */
  onDestroy?: (stage: Stage) => void
}

/**
 * Svelte action for a second `<canvas>` driven by an existing engine. Attaches
 * a {@link Stage} via {@link Engine.attachStage} on mount, calls `onReady(stage)`
 * so the caller can build the stage's scene, and detaches on unmount. The
 * counterpart to `mountEngine` for the primary canvas.
 *
 * A secondary stage has its own `Scene`, `Camera`, and `Layers` but shares the
 * engine's ticker and `Animator`, so tweens on both canvases stay in sync. Used
 * for a side card that renders through the same clock as the main view (a
 * tutorial mini-view, a game-over panel). Attach it as `use:mountStage={{
 * engine, options, onReady }}`.
 *
 * @category Svelte
 */
export function mountStage(
  canvas: HTMLCanvasElement,
  params: MountStageParams,
): { destroy(): void } {
  const stage = params.engine.attachStage(canvas, params.options)
  const readyPromise = Promise.resolve().then(() => params.onReady?.(stage))

  return {
    destroy() {
      readyPromise
        .catch((err) => {
          console.error('[stargazer] mountStage.onReady failed:', err)
        })
        .finally(() => {
          try {
            params.onDestroy?.(stage)
          } finally {
            params.engine.detachStage(stage)
          }
        })
    },
  }
}
