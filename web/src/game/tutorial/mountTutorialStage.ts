import type { EngineHost } from '@src/stargazer'
import { TutorialSession } from './TutorialSession'

export interface MountTutorialStageParams {
  /** The primary engine host, the tutorial attaches a secondary stage to it. */
  host: EngineHost
  /** Fires after the session's scene is built. Useful for tests / diagnostics. */
  onReady?: (session: TutorialSession) => void
  /** Fires before the session is destroyed on unmount. */
  onDestroy?: (session: TutorialSession) => void
}

/**
 * Svelte action for the tutorial `<canvas>` inside `StateConfirmCard`. Owns one
 * `TutorialSession` for the lifetime of the canvas: constructs it on mount,
 * tears it down (aborting any pending respawn and detaching the secondary
 * `Stage`) on unmount. Mirrors `mountStage` from stargazer; the difference is
 * that the callback receives a `TutorialSession` rather than a raw `Stage`.
 *
 * @example
 *   <canvas
 *   use:mountTutorialStage={{ host }}
 *   ></canvas>
 */
export function mountTutorialStage(
  canvas: HTMLCanvasElement,
  params: MountTutorialStageParams,
): { destroy(): void } {
  const session = new TutorialSession(params.host, canvas)
  try {
    params.onReady?.(session)
  } catch (err) {
    console.error('[tutorial] mountTutorialStage.onReady failed:', err)
  }

  return {
    destroy() {
      try {
        params.onDestroy?.(session)
      } finally {
        session.destroy()
      }
    },
  }
}
