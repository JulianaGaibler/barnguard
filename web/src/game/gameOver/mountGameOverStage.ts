import type { EngineHost } from '@src/stargazer'
import { loadGameAssets } from '../assets'
import { GameOverScene } from './GameOverScene'
import type { GameOverReason } from '../session'

export interface MountGameOverStageParams {
  host: EngineHost
  reason: GameOverReason
  /** Escape heading (radians). Only relevant for `'exitedGermany'`. */
  escapeHeadingRad?: number
}

/**
 * Svelte action for the loss-card canvas inside `GameOverOverlay`. Kicks off
 * the appropriate reason-specific animation on mount and tears it down on
 * unmount.
 *
 * `loadGameAssets()` is async, needed for the eye SVG paths. If the overlay
 * unmounts before the promise resolves (memoised loader, usually < 1 ms after
 * first call, but not guaranteed), the `aborted` closure flag prevents the
 * constructor from firing on a stale canvas. Without this guard, a fast
 * dismiss
 *
 * - Re-open cycle would leak a `GameOverScene` whose `Stage` stays attached to
 *   the engine forever.
 */
export function mountGameOverStage(
  canvas: HTMLCanvasElement,
  params: MountGameOverStageParams,
): { destroy(): void } {
  let scene: GameOverScene | null = null
  let aborted = false

  void loadGameAssets()
    .then((assets) => {
      if (aborted) return
      const parts = Array.from(assets.eye.paths.values())
      if (parts.length === 0) {
        console.warn(
          '[mountGameOverStage] eye.svg parsed to zero paths, loss animation will have no eyes',
        )
      }
      scene = new GameOverScene(params.host, canvas, {
        reason: params.reason,
        escapeHeadingRad: params.escapeHeadingRad,
        eyeOutlineParts: parts,
        impactFlashPath: assets.impactFlashPath,
      })
    })
    .catch((err) => {
      if (aborted) return
      console.error('[mountGameOverStage] loadGameAssets failed:', err)
    })

  return {
    destroy(): void {
      aborted = true
      scene?.destroy()
      scene = null
    },
  }
}
