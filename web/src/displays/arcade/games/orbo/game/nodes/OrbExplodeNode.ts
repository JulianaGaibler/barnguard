/**
 * Orb explosion: an orb bursts into a spray of shrapnel (triangles + line
 * shards) that fly outward under exponential drag while spinning. Each piece
 * SHRINKS as its own velocity decays, so the burst dissolves to nothing instead
 * of settling into a permanent ring; the node self-destructs once every piece
 * has effectively stopped. Built on `VectorParticleNode` — the shared engine
 * base for physics-driven bursts that need per-piece vector shapes (mixed
 * triangle/line pieces here) rather than a single baked sprite.
 *
 * Used both mid-game (an orb whose lifetime runs out) and at round end (the
 * losing side). Parallel typed-array storage, zero per-frame allocation.
 */
import {
  VectorParticleNode,
  type CameraView2D,
  type Gfx2D,
  type Vec2,
  type VectorParticleSpawnInit,
} from '@src/stargazer'

/** Reused scratch for the per-piece equilateral triangle (draw is synchronous). */
const TRI_SCRATCH = new Float32Array(6)

// Everything is derived from the orb radius so a big orb throws a bigger, faster
// burst than a small one. Feel knobs.
const COUNT_BASE = 9
const COUNT_PER_RADIUS = 0.22
const TRIANGLE_FRACTION = 0.6
const SPEED_MIN_PER_RADIUS = 3
const SPEED_MAX_PER_RADIUS = 7
const DAMPING_PER_SEC = 3.2
const SPIN_MAX_RAD_PER_SEC = 9
const TRIANGLE_SIDE_PER_RADIUS = 0.5
const LINE_LENGTH_PER_RADIUS = 0.85
const LINE_WIDTH_CSS_PX = 2
/** Below this fraction of a piece's own launch speed it's considered stopped. */
const MIN_SPEED_FRAC = 0.02
/** Hard backstop so a piece never lingers forever. */
const MAX_LIFE_SEC = 3

export class OrbExplodeNode extends VectorParticleNode {
  readonly #spin: Float32Array
  /** 0 = triangle, 1 = line. */
  readonly #kind: Uint8Array

  readonly #speedMin: number
  readonly #speedMax: number
  readonly #triangleSide: number
  readonly #lineHalf: number
  readonly #color: string

  /**
   * Staged for the particle `burst(1)` is about to spawn; read back inside
   * `spawnParticle`.
   */
  #pendingTheta = 0
  #age = 0

  constructor(center: Vec2, color: string, sourceRadius: number) {
    const count = Math.max(
      6,
      Math.round(COUNT_BASE + sourceRadius * COUNT_PER_RADIUS),
    )
    super({
      id: 'orb-explode',
      capacity: count,
      dampingPerSec: DAMPING_PER_SEC,
    })
    this.transform.x = center.x
    this.transform.y = center.y

    this.#spin = new Float32Array(count)
    this.#kind = new Uint8Array(count)
    this.#speedMin = sourceRadius * SPEED_MIN_PER_RADIUS
    this.#speedMax = sourceRadius * SPEED_MAX_PER_RADIUS
    this.#triangleSide = sourceRadius * TRIANGLE_SIDE_PER_RADIUS
    this.#lineHalf = sourceRadius * LINE_LENGTH_PER_RADIUS * 0.5
    this.#color = color

    // Evenly-spaced radial emission with jitter so it reads as a scatter,
    // rather than the fully-random angle `burst(count)` would sample.
    const slot = (Math.PI * 2) / count
    const jitter = slot * 0.35
    for (let i = 0; i < count; i++) {
      this.#pendingTheta = i * slot + (Math.random() * 2 - 1) * jitter
      this.burst(1)
    }
    void this.autoDestroy(this.waitUntilEmpty())
  }

  protected override spawnParticle(
    i: number,
    out: VectorParticleSpawnInit,
  ): void {
    const theta = this.#pendingTheta
    const speed =
      this.#speedMin + Math.random() * (this.#speedMax - this.#speedMin)
    out.x = 0
    out.y = 0
    out.vx = Math.cos(theta) * speed
    out.vy = Math.sin(theta) * speed
    out.angle = Math.random() * Math.PI * 2
    out.speed0 = speed
    this.#spin[i] = (Math.random() * 2 - 1) * SPIN_MAX_RAD_PER_SEC
    this.#kind[i] = Math.random() < TRIANGLE_FRACTION ? 0 : 1
  }

  protected override updateExtra(i: number, dt: number): void {
    this.angle[i] += this.#spin[i] * dt
  }

  protected override shouldDespawn(i: number): boolean {
    const speed0 = this.speed0[i]
    if (speed0 <= 0) return false
    return Math.hypot(this.vx[i], this.vy[i]) < MIN_SPEED_FRAC * speed0
  }

  override onUpdate(dt: number): void {
    super.onUpdate(dt)
    if (dt <= 0) return
    this.#age += dt
    // Not permanent: also gone if it's been going too long, regardless of
    // whether every piece has individually crossed the speed threshold yet.
    if (this.#age >= MAX_LIFE_SEC) this.destroy()
  }

  protected override drawParticle(
    gfx: Gfx2D,
    i: number,
    camera: CameraView2D,
  ): void {
    // Shrink with the piece's remaining speed so it dissolves as it slows.
    const scale = Math.min(
      1,
      Math.hypot(this.vx[i], this.vy[i]) / this.speed0[i],
    )
    if (scale <= 0.02) return
    gfx.scale(scale, scale)
    if (this.#kind[i] === 0) {
      const side = this.#triangleSide
      const height = side * (Math.sqrt(3) / 2)
      const tri = TRI_SCRATCH
      tri[0] = 0
      tri[1] = -height * (2 / 3)
      tri[2] = side * 0.5
      tri[3] = height * (1 / 3)
      tri[4] = -side * 0.5
      tri[5] = height * (1 / 3)
      gfx.fillConvexPoly(tri, 3, this.#color)
    } else {
      gfx.strokeLine(-this.#lineHalf, 0, this.#lineHalf, 0, {
        color: this.#color,
        width: LINE_WIDTH_CSS_PX * camera.strokeSpaceScale(),
        cap: 'round',
      })
    }
  }
}
