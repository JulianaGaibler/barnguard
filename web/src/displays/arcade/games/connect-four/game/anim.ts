import {
  Node2D,
  ParticleEmitterNode,
  easings,
  ignoreAbort,
  type Vec2,
} from '@src/stargazer'
import { COLS } from './board'
import { cellCenter, type BoardLayout } from './layout'
import { DiscNode } from './nodes/DiscNode'
import { WinLineNode } from './nodes/WinLineNode'
import { ANIM, WIN } from './tuning'
import type { CellRef } from './types'

/** Scale the winning discs pop to on the pre-burst pulse. */
const WIN_PULSE_SCALE = 1.25

/**
 * Celebrate a winning line: recolor each winning disc to its glow shade and
 * pulse it, then draw a connecting line on with a node mark per chip and a
 * square burst at every winning cell. Shared by the live session and the
 * tutorial demo so the celebration stays in sync. `shouldAbort` bails between
 * the pulse and the line/bursts — the session passes its move-generation guard,
 * the demo its destroy guard.
 */
export async function playWinHighlight(opts: {
  cells: readonly CellRef[]
  discByCell: Map<number, DiscNode>
  layout: BoardLayout
  /** Lighter shade the winning discs + bursts take. */
  glowColor: string
  discRadius: number
  winLayer: Node2D
  shouldAbort: () => boolean
}): Promise<void> {
  const {
    cells,
    discByCell,
    layout,
    glowColor,
    discRadius,
    winLayer,
    shouldAbort,
  } = opts

  await Promise.all(
    cells.map((cell) => {
      const disc = discByCell.get(cell.row * COLS + cell.col)
      disc?.setColor(glowColor)
      return disc
        ?.tween(
          { scaleX: WIN_PULSE_SCALE, scaleY: WIN_PULSE_SCALE },
          { duration: ANIM.winPulse, easing: easings.outBack },
        )
        .catch(ignoreAbort)
    }),
  )
  if (shouldAbort()) return

  const centers = cells.map((cell) => cellCenter(layout, cell.col, cell.row))
  winLayer.add(new WinLineNode(centers, layout.cell))
  for (const center of centers) {
    winLayer.add(createWinBurst(center, glowColor, discRadius))
  }
}

/**
 * Square burst at a winning cell: squares spin and shrink as they slow,
 * evenly spaced around the circle (with jitter, so a small burst doesn't
 * clump) in the winning player's glow color. Self-destroys once every piece
 * has settled.
 */
function createWinBurst(
  center: Vec2,
  color: string,
  discRadius: number,
): ParticleEmitterNode {
  const b = WIN.burst
  const count = Math.max(
    6,
    Math.round(b.countBase + discRadius * b.countPerRadius),
  )
  const side = discRadius * b.sizePerRadius
  const node = new ParticleEmitterNode({
    config: {
      capacity: count,
      ratePerSec: 0,
      lifetimeSec: [b.lifetimeSecMax, b.lifetimeSecMax],
      speedWorld: [
        discRadius * b.speedMinPerRadius,
        discRadius * b.speedMaxPerRadius,
      ],
      spreadRad: 0,
      sizeWorld: [side, side],
      palette: [color],
      spriteStyle: 'square',
      blend: 'source-over',
      dampingPerSec: b.dampingPerSec,
      spinRadPerSec: [-b.spinMaxRadPerSec, b.spinMaxRadPerSec],
      scaleBy: 'speed',
      scaleOverLife: [1, 0],
      minSpeedFrac: b.minSpeedFrac,
    },
  })
  node.transform.x = center.x
  node.transform.y = center.y
  // Evenly-spaced-with-jitter emission: `burst()` alone samples a fully
  // random angle per particle, so drive it one piece at a time with a
  // manually computed axis to avoid clumpy-looking small bursts.
  const slot = (Math.PI * 2) / count
  const jitter = slot * 0.35
  for (let i = 0; i < count; i++) {
    const theta = i * slot + (Math.random() * 2 - 1) * jitter
    node.emitter.burst(1, 0, 0, theta)
  }
  void node.autoDestroy(node.emitter.waitUntilEmpty())
  return node
}
