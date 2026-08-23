/**
 * Confetti falling over the board when a run reaches 2048.
 *
 * Deliberately a different motion signature from {@link MergeBurstNode}: those
 * shards fly outward from a cell and slow to a stop, these are released above
 * the plate and fall through it under gravity. A merge and the goal should not
 * look like the same event at different volumes.
 *
 * Released over about a second rather than all at once, so the board rains
 * rather than coughing.
 */
import { type Gfx2D } from '@src/stargazer'
import type { Bounds } from '../types'
import { GOAL, TILE_COLORS } from '../tuning'
import { ShardNode } from './ShardNode'

/** Fed from the warm end of the ramp, so the rain reads as celebratory. */
const COLORS = TILE_COLORS.slice(3)

/**
 * A rectangle about its centre, in units of the shard size. Paper, not
 * shrapnel.
 */
const RECT = [-1, -0.45, 1, -0.45, 1, 0.45, -1, 0.45]

export class GoalRainNode extends ShardNode {
  /** Shards still to release, and the gap between releases. */
  #queued = 0
  #interval = 0
  #sinceLast = 0
  #plate: Bounds = { x: 0, y: 0, width: 0, height: 0 }
  #cell = 1

  constructor() {
    super({ id: 't48-goal-rain', capacity: GOAL.rainCount })
  }

  /** Start raining over `plate`. Re-firing restarts rather than stacking. */
  fire(plate: Bounds, cell: number): void {
    this.#plate = plate
    this.#cell = cell
    this.#queued = GOAL.rainCount
    this.#interval = GOAL.rainDurationSec / GOAL.rainCount
    this.#sinceLast = 0
    this.debugBounds = {
      x: plate.x - cell,
      y: plate.y - plate.height * GOAL.rainStartAbove - cell,
      width: plate.width + cell * 2,
      height: plate.height + cell * 2,
    }
  }

  override onUpdate(dt: number): void {
    if (this.#queued > 0) {
      this.#sinceLast += dt
      while (this.#queued > 0 && this.#sinceLast >= this.#interval) {
        this.#sinceLast -= this.#interval
        this.#queued -= 1
        this.#drop()
      }
    }
    super.onUpdate(dt)
  }

  #drop(): void {
    const cell = this.#cell
    const p = this.#plate
    const sizeSpan = GOAL.rainMaxSize - GOAL.rainMinSize
    const speedSpan = GOAL.rainMaxSpeed - GOAL.rainMinSpeed
    this.stage.x = p.x + Math.random() * p.width
    this.stage.y = p.y - p.height * GOAL.rainStartAbove
    this.stage.vx = (Math.random() - 0.5) * 2 * GOAL.rainDrift * cell
    this.stage.vy = cell * (GOAL.rainMinSpeed + Math.random() * speedSpan)
    this.stage.size = cell * (GOAL.rainMinSize + Math.random() * sizeSpan)
    this.stage.spin = (Math.random() - 0.5) * 10
    this.stage.color =
      COLORS[Math.floor(Math.random() * COLORS.length)] ?? COLORS[0]
    this.release()
  }

  protected override integrate(i: number, dt: number): void {
    // Gravity is applied here rather than through the base class's
    // `accelerationWorld`, which is fixed at construction and so cannot scale
    // with a board that resizes.
    this.vy[i] += GOAL.rainGravity * this.#cell * dt
  }

  protected override shouldDespawn(i: number): boolean {
    return this.y[i] > this.#plate.y + this.#plate.height + this.#cell
  }

  protected override drawParticle(gfx: Gfx2D, i: number): void {
    this.fillShard(gfx, i, RECT, 4)
  }
}
