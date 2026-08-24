/**
 * Sparks thrown sideways out of a cleared row.
 *
 * A long-lived pool rather than a node per clear: a combo can fire four bursts
 * in a second, and building and destroying an emitter each time would churn the
 * particle pool for no benefit.
 *
 * Additive, because the buffer behind it is near-black and a source-over spark
 * on that reads as grey rather than as light.
 */
import { ParticleEmitterNode } from '@src/stargazer'
import { PIECE_COLORS } from '../tuning'
import type { Bounds } from '../types'

/** Sparks per cleared row. A flush throws four times this. */
const PER_ROW = 26
const CAPACITY = 240

export class ClearBurstNode extends ParticleEmitterNode {
  constructor() {
    super({
      id: 'bo-clear-burst',
      config: {
        capacity: CAPACITY,
        // One-shot only. Nothing streams here.
        ratePerSec: 0,
        lifetimeSec: [0.25, 0.55],
        speedWorld: [220, 700],
        // A narrow, near-horizontal cone: the row is leaving sideways, and a
        // radial puff would read as an explosion rather than as a row going.
        spreadRad: 0.32,
        emitDirectionRad: 0,
        sizeWorld: [3, 11],
        palette: Object.values(PIECE_COLORS),
        // Blocks rather than soft dots: what came out of the buffer was
        // cells, and additive squares on a near-black field read as phosphor
        // where a gradient reads as gloss.
        spriteStyle: 'square',
        blend: 'lighter',
        dampingPerSec: 4.2,
        accelerationWorld: { x: 0, y: 900 },
        scaleOverLife: [1, 0.15],
        alphaOverLife: [1, 0],
        // Dissolve as they slow rather than on a fixed clock, so a spark that
        // has come to rest is already gone.
        scaleBy: 'speed',
        minSpeedFrac: 0.08,
      },
    })
    this.renderLayer = 'dynamic'
  }

  /** Fire out of both ends of each cleared row. */
  fire(
    buffer: Bounds,
    cell: number,
    rows: readonly number[],
    top: number,
  ): void {
    for (const row of rows) {
      const y = buffer.y + (row - top + 0.5) * cell
      this.emitter.burst(PER_ROW, buffer.x, y, 0)
      this.emitter.burst(PER_ROW, buffer.x + buffer.width, y, Math.PI)
    }
  }
}
