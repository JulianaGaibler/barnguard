// Shared loss-moment visuals: the impact-flash sparkle and the debris bursts.
// Both the live round (`session.ts`) and the game-over vignette
// (`gameOver/GameOverScene.ts`) draw the identical effect, so the geometry and
// every `TUNING.lossAnim.*` knob live here once. Each takes the parent node to
// attach to, so the caller controls which layer/tree the visual lands in.

import { Path2DNode, easings, type Node, type Vec2 } from '@src/stargazer'
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
export function spawnCollisionDebris(parent: Node, center: Vec2): void {
  const c = TUNING.lossAnim.debris
  parent.add(
    new DebrisBurstNode({
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
    }),
  )
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
