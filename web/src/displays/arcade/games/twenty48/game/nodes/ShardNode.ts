/**
 * Shared plumbing for the game's two confetti nodes.
 *
 * `VectorParticleNode` gives every particle a position, velocity and angle.
 * Both of 2048's bursts want three more things per shard (a size, a spin rate
 * and a colour) and both stage those alongside a position and velocity for the
 * next `burst(1)`, per the base class's synchronous spawn contract. That much
 * is identical, so it lives here.
 *
 * What differs stays in the subclasses, because it is what makes them read as
 * different events: how a shard is launched, when it is done, and what shape it
 * is. A merge throws triangles outward that slow to a stop; the goal drops
 * rectangles that fall past the board.
 */
import {
  type Gfx2D,
  VectorParticleNode,
  type VectorParticleNodeOptions,
  type VectorParticleSpawnInit,
} from '@src/stargazer'

/** One shard's worth of state, staged immediately before `release()`. */
export interface ShardStage {
  x: number
  y: number
  vx: number
  vy: number
  size: number
  spin: number
  color: string
}

export abstract class ShardNode extends VectorParticleNode {
  protected readonly size: Float32Array
  protected readonly spin: Float32Array
  protected readonly color: string[]
  /** Filled in by a subclass, then handed to the next spawned slot. */
  protected readonly stage: ShardStage = {
    x: 0,
    y: 0,
    vx: 0,
    vy: 0,
    size: 1,
    spin: 0,
    color: '#000000',
  }
  /** Scratch for one shard's points, so drawing allocates nothing. */
  protected readonly poly = new Float32Array(8)

  constructor(opts: VectorParticleNodeOptions) {
    super(opts)
    this.renderLayer = 'dynamic'
    this.size = new Float32Array(opts.capacity)
    this.spin = new Float32Array(opts.capacity)
    this.color = new Array<string>(opts.capacity).fill('#000000')
  }

  /** Spawn one shard from whatever is currently in {@link ShardNode.stage}. */
  protected release(): void {
    this.burst(1)
  }

  protected override spawnParticle(
    i: number,
    out: VectorParticleSpawnInit,
  ): void {
    const s = this.stage
    out.x = s.x
    out.y = s.y
    out.vx = s.vx
    out.vy = s.vy
    out.angle = Math.random() * Math.PI * 2
    out.speed0 = Math.hypot(s.vx, s.vy)
    this.size[i] = s.size
    this.spin[i] = s.spin
    this.color[i] = s.color
  }

  protected override updateExtra(i: number, dt: number): void {
    this.angle[i] += this.spin[i] * dt
    this.integrate(i, dt)
  }

  /** Extra per-shard motion beyond spin. Gravity, drag, whatever. */
  protected integrate(_i: number, _dt: number): void {}

  /**
   * Fill shard `i` as a convex polygon whose local points are `local`, an
   * interleaved `[x, y, …]` list, rotated by the shard's angle and scaled by
   * its size.
   */
  protected fillShard(
    gfx: Gfx2D,
    i: number,
    local: ArrayLike<number>,
    count: number,
    scale = 1,
  ): void {
    const a = this.angle[i]
    const cos = Math.cos(a)
    const sin = Math.sin(a)
    const s = this.size[i] * scale
    const px = this.x[i]
    const py = this.y[i]
    const out = this.poly
    for (let k = 0; k < count; k++) {
      const lx = local[k * 2] * s
      const ly = local[k * 2 + 1] * s
      out[k * 2] = px + lx * cos - ly * sin
      out[k * 2 + 1] = py + lx * sin + ly * cos
    }
    gfx.fillConvexPoly(out, count, this.color[i])
  }
}
