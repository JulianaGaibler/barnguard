import type { Engine } from '../engine/Engine'
import type { Stage, StageOptions } from '../render/Stage'

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
 * Svelte action for a secondary `<canvas>` element. Attaches a `Stage` to the
 * given engine on mount, calls `onReady(stage)` so the caller can build a
 * scene, and detaches on unmount. Mirrors `mountEngine`.
 *
 * @example
 *   <canvas
 *   use:mountStage={{
 *   engine,
 *   options: { initialViewport: { x: -100, y: -100, width: 200, height: 200 } },
 *   onReady: (stage) => buildLossScene(stage),
 *   }}
 *   ></canvas>
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
