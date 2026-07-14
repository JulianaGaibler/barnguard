import { Behaviour, easings } from '@src/stargazer'
import type { EpicenterNode } from '../nodes/EpicenterNode'
import { TUNING } from '../data/tuning'

/** Grow-pulse tuning, see `EpicenterNode.pulseScale`. */
const PULSE_GROW_SEC = 4
const PULSE_WAIT_SEC = 3
/** Full turn of the dashed capture ring per this many seconds. */
const DASH_ROTATION_PERIOD_SEC = 24
const DASH_ROTATION_SPEED_RAD_PER_SEC = (Math.PI * 2) / DASH_ROTATION_PERIOD_SEC

/**
 * Drives the epicenter's animated visuals:
 *
 * - The existing outer-ring intro grow-in + breathing alpha loop.
 * - The cyan gradient pulse disc that grows from 0 → 1 over 2 s, resets, waits 3
 *   s, repeats.
 * - Continuous rotation of the dashed capture ring so the perimeter reads as
 *   active without any per-frame heavy work.
 *
 * All loops are scoped to `node.abortSignal` so destroying the epicenter
 * cascades AbortErrors and cleans up naturally.
 */
export class EpicenterBehaviour extends Behaviour {
  override onSceneReady(): void {
    const target = this.node as EpicenterNode

    // Grow-pulse: reset pulseScale to 0, tween up to 1, wait, repeat.
    this.node.loop(
      async ({ node }) => {
        target.pulseScale = 0
        await node.tweenTo(
          target,
          { pulseScale: 1 },
          {
            duration: PULSE_GROW_SEC,
            // Ease-out, grows fast early, decelerates as it approaches
            // the outer ring. Reads as the disc "settling" into place
            // rather than punching through at a constant speed.
            easing: easings.outQuad,
          },
        )
        target.pulseScale = 0
        await node.wait(PULSE_WAIT_SEC)
      },
      { name: 'epicenter-growPulse' },
    )

    // Outer breathing pulse, one-shot intro, then infinite alpha loop.
    // Kick off the intro grow-in as a separate loop that exits after one
    // iteration by throwing an abort-like sentinel, but simpler: fire it
    // as a plain tween in onSceneReady and start the alpha loop right
    // after. Using `loop` for the ongoing part only.
    target.outerScale = 0.7
    void this.node
      .tweenTo(
        target,
        { outerScale: 1 },
        { duration: 0.45, easing: easings.outBack },
      )
      .catch(() => {
        // Aborted before completion, the loop below will still start;
        // scene-attached loops don't care about the intro's fate.
      })

    const halfPulse = TUNING.epicenter.pulsePeriodSec / 2
    this.node.loop(
      async ({ node }) => {
        await node.tweenTo(
          target,
          { outerAlpha: 0.55 },
          { duration: halfPulse, easing: easings.inOutQuad },
        )
        await node.tweenTo(
          target,
          { outerAlpha: 1 },
          { duration: halfPulse, easing: easings.inOutQuad },
        )
      },
      { name: 'epicenter-outerBreathe' },
    )
  }

  override onUpdate(dt: number): void {
    // Continuous rotation, cheaper as a per-frame accumulator than a
    // long-running tween that would restart every full turn. Modulo
    // 2π keeps the accumulator bounded across long sessions.
    const target = this.node as EpicenterNode
    target.dashRotation =
      (target.dashRotation + DASH_ROTATION_SPEED_RAD_PER_SEC * dt) %
      (Math.PI * 2)
  }
}
