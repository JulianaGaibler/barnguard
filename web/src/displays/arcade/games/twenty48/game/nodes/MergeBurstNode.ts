/**
 * Shards thrown out by a merge, pooled per board.
 *
 * One long-lived node rather than one per merge: in versus, two players
 * chaining merges can easily fire eight bursts a second, and a pool keeps that
 * allocation-free. Each shard carries its own color so a single pool serves
 * every tile value.
 */
import { type Gfx2D } from '@src/stargazer'
import { BURST, exponentOf, tileColor } from '../tuning'
import { ShardNode } from './ShardNode'

/** Shard slots per board. Sized for a fast player chaining merges. */
const CAPACITY = 180

/** An equilateral triangle about its centre, in units of the shard size. */
const TRIANGLE = [1, 0, -0.5, 0.866, -0.5, -0.866]

export class MergeBurstNode extends ShardNode {
  constructor() {
    super({
      id: 't48-burst',
      capacity: CAPACITY,
      dampingPerSec: BURST.dampingPerSec,
    })
  }

  /**
   * Fire a burst at a cell centre. Bigger merges throw more and faster, so the
   * board's reaction scales with what the player actually did.
   */
  fire(x: number, y: number, value: number, cell: number): void {
    const steps = Math.max(1, exponentOf(value))
    const count = Math.min(BURST.maxCount, BURST.baseCount + steps * 2)
    const color = tileColor(value)
    const speedSpan = BURST.maxSpeed - BURST.minSpeed
    const sizeSpan = BURST.maxSize - BURST.minSize
    for (let i = 0; i < count; i++) {
      const a = Math.random() * Math.PI * 2
      const speed = cell * (BURST.minSpeed + Math.random() * speedSpan)
      this.stage.x = x
      this.stage.y = y
      this.stage.vx = Math.cos(a) * speed
      this.stage.vy = Math.sin(a) * speed
      this.stage.size = cell * (BURST.minSize + Math.random() * sizeSpan)
      this.stage.spin = (Math.random() - 0.5) * 2 * BURST.spin
      this.stage.color = color
      this.release()
    }
  }

  protected override shouldDespawn(i: number): boolean {
    return Math.hypot(this.vx[i], this.vy[i]) < BURST.stopSpeed
  }

  protected override drawParticle(gfx: Gfx2D, i: number): void {
    // Shards shrink and fade as they slow, so a burst tapers off instead of
    // snapping out of existence when a slot recycles.
    const speed = Math.hypot(this.vx[i], this.vy[i])
    const ratio = this.speed0[i] > 0 ? speed / this.speed0[i] : 0
    gfx.setAlpha(Math.min(1, ratio * 1.6))
    this.fillShard(gfx, i, TRIANGLE, 3, Math.min(1, 0.35 + ratio))
    gfx.setAlpha(1)
  }
}
