import { Behavior, easings } from 'stargazer'
import type { EpicenterNode } from '../nodes/EpicenterNode'
import { TUNING } from '../data/tuning'

/**
 * Drives the epicenter's animated visuals:
 *
 * - A one-shot grow-in of the cone's dot field when the epicenter appears.
 * - The wave travelling inward through the dots, advanced every frame by one
 *   wavelength per `TUNING.epicenter.dots.wavePeriodSec`.
 *
 * The grow-in is scoped to `node.abortSignal`, so destroying the epicenter
 * cancels it.
 */
export class EpicenterBehavior extends Behavior {
  override onSceneReady(): void {
    const target = this.node as EpicenterNode
    target.outerScale = 0.7
    void this.node
      .tweenTo(
        target,
        { outerScale: 1 },
        { duration: 0.45, easing: easings.outBack },
      )
      .catch(() => {
        // Aborted before completion, nothing to clean up.
      })
  }

  override onUpdate(dt: number): void {
    const target = this.node as EpicenterNode
    target.wavePhase += dt / TUNING.epicenter.dots.wavePeriodSec
  }
}
