// Shared loss-moment visuals: the impact-flash sparkle and the debris bursts.
// Both the live round (`session.ts`) and the game-over vignette
// (`gameOver/GameOverScene.ts`) draw the identical effect, so the geometry and
// every `TUNING.lossAnim.*` knob live here once. Each takes the parent node to
// attach to, so the caller controls which layer/tree the visual lands in.

import {
  Path2DNode,
  easings,
  ignoreAbort,
  type EngineHost,
  type Node,
  type Vec2,
} from '@src/stargazer'
import { DebrisBurstNode } from './nodes/DebrisBurstNode'
import { TUNING } from './data/tuning'

let flashIdSeq = 0

/** A scaled + fading sparkle at `center`, using the pre-centred flash path. */
export function spawnImpactFlash(
  parent: Node,
  center: Vec2,
  path: Path2D,
): void {
  const cfg = TUNING.lossAnim.impactFlash
  const flash = new Path2DNode({
    id: `impact-flash-${flashIdSeq++}`,
    path,
    fill: cfg.color,
    hitMode: 'none',
  })
  flash.transform.x = center.x
  flash.transform.y = center.y
  flash.transform.scaleX = cfg.scaleFrom
  flash.transform.scaleY = cfg.scaleFrom
  parent.add(flash)
  void flash.autoDestroy(
    flash.tween(
      { scaleX: cfg.scaleTo, scaleY: cfg.scaleTo, alpha: 0 },
      { duration: cfg.durationSec, easing: easings.outCubic },
    ),
  )
}

/**
 * Radial explosion (triangles + lines) at `center`, the head-on collision
 * burst.
 */
export function spawnCollisionDebris(
  parent: Node,
  center: Vec2,
): DebrisBurstNode {
  const c = TUNING.lossAnim.debris
  const node = new DebrisBurstNode({
    center,
    count: c.count,
    triangleFraction: c.triangleFraction,
    initialSpeedWorld: c.initialSpeedWorld,
    dampingPerSec: c.dampingPerSec,
    angInitialRadPerSec: c.angInitialRadPerSec,
    angInitialDampingPerSec: c.angInitialDampingPerSec,
    angBaseAbsRadPerSec: c.angBaseAbsRadPerSec,
    triangleSideWorld: c.triangleSideWorld,
    lineLengthWorld: c.lineLengthWorld,
    lineWidthCssPx: c.lineWidthCssPx,
    color: c.color,
    equidistantEmission: c.equidistantEmission,
  })
  parent.add(node)
  return node
}

/** How long a decaying burst holds before it fades, and the fade length. */
const DEBRIS_HOLD_SEC = 1.6
const DEBRIS_FADE_SEC = 0.6

/**
 * Collision debris that decays on its own. The plain burst above settles into a
 * PERMANENT ring (the live round sweeps it on reset), which piles up in
 * continuous scenes with no reset — the menu preview and the tutorial demo. So
 * those spawn through this variant instead: it holds briefly, fades the whole
 * burst out, then self-destroys. `signal` cancels the pending fade on
 * teardown.
 */
export function spawnDecayingCollisionDebris(
  parent: Node,
  center: Vec2,
  host: EngineHost,
  signal?: AbortSignal,
): void {
  const node = spawnCollisionDebris(parent, center)
  host.engine
    .wait(DEBRIS_HOLD_SEC, signal)
    .then(() => {
      if (node.isDestroyed) return
      void node.autoDestroy(
        node.tween(
          { alpha: 0 },
          { duration: DEBRIS_FADE_SEC, easing: easings.inQuad },
        ),
      )
    })
    .catch(ignoreAbort)
}

/**
 * Directional lines-only burst along `headingRad` (the packet's exit velocity):
 * each shard launches broadside to its flight path and tumbles as it drifts
 * out, the "border breach" moment.
 */
export function spawnBorderBreachDebris(
  parent: Node,
  center: Vec2,
  headingRad: number,
): void {
  const c = TUNING.lossAnim.borderBreach
  parent.add(
    new DebrisBurstNode({
      center,
      count: c.count,
      triangleFraction: c.triangleFraction,
      initialSpeedWorld: c.initialSpeedWorld,
      dampingPerSec: c.dampingPerSec,
      emitDirectionRad: headingRad,
      emitSpreadRad: c.emitSpreadRad,
      initialAngleOffsetRad: c.initialAngleOffsetRad,
      angInitialRadPerSec: c.angInitialRadPerSec,
      angInitialDampingPerSec: c.angInitialDampingPerSec,
      angBaseAbsRadPerSec: c.angBaseAbsRadPerSec,
      triangleSideWorld: c.triangleSideWorld,
      lineLengthWorld: c.lineLengthWorld,
      lineWidthCssPx: c.lineWidthCssPx,
      color: c.color,
    }),
  )
}
