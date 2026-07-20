/**
 * Orb explosion: an orb bursts into a spray of shrapnel (triangles + line
 * shards) that fly outward under exponential drag while spinning. Each piece
 * SHRINKS as its own velocity decays, so the burst dissolves to nothing instead
 * of settling into a permanent ring; the node self-destructs once every piece
 * has effectively stopped. Adapted from stallwaechter's `DebrisBurstNode`.
 *
 * Used both mid-game (an orb whose lifetime runs out) and at round end (the
 * losing side). Parallel typed-array storage, zero per-frame allocation.
 */
import { SceneNode, type Camera, type Gfx2D, type Vec2 } from '@src/stargazer'

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
/** Below this fraction of a piece's launch speed it's considered stopped. */
const STOP_SPEED_FRAC = 0.06
/** Hard backstop so a piece never lingers forever. */
const MAX_LIFE_SEC = 3

export class OrbExplodeNode extends SceneNode {
  readonly #count: number
  readonly #x: Float32Array
  readonly #y: Float32Array
  readonly #vx: Float32Array
  readonly #vy: Float32Array
  readonly #angle: Float32Array
  readonly #spin: Float32Array
  /** Launch speed per piece; drives the shrink (scale = curSpeed / speed0). */
  readonly #speed0: Float32Array
  /** 0 = triangle, 1 = line. */
  readonly #kind: Uint8Array

  readonly #triangleSide: number
  readonly #lineHalf: number
  readonly #color: string
  /** Absolute stop threshold (world u/s), from the slowest launch speed. */
  readonly #stopSpeed: number

  #age = 0

  constructor(center: Vec2, color: string, sourceRadius: number) {
    super('orb-explode')
    this.renderLayer = 'dynamic'
    this.transform.x = center.x
    this.transform.y = center.y

    const n = Math.max(
      6,
      Math.round(COUNT_BASE + sourceRadius * COUNT_PER_RADIUS),
    )
    this.#count = n
    this.#x = new Float32Array(n)
    this.#y = new Float32Array(n)
    this.#vx = new Float32Array(n)
    this.#vy = new Float32Array(n)
    this.#angle = new Float32Array(n)
    this.#spin = new Float32Array(n)
    this.#speed0 = new Float32Array(n)
    this.#kind = new Uint8Array(n)
    this.#triangleSide = sourceRadius * TRIANGLE_SIDE_PER_RADIUS
    this.#lineHalf = sourceRadius * LINE_LENGTH_PER_RADIUS * 0.5
    this.#color = color

    const speedMin = sourceRadius * SPEED_MIN_PER_RADIUS
    const speedMax = sourceRadius * SPEED_MAX_PER_RADIUS
    this.#stopSpeed = speedMin * STOP_SPEED_FRAC
    // Evenly-spaced radial emission with jitter so it reads as a scatter.
    const slot = (Math.PI * 2) / n
    const jitter = slot * 0.35
    for (let i = 0; i < n; i++) {
      const theta = i * slot + (Math.random() * 2 - 1) * jitter
      const speed = speedMin + Math.random() * (speedMax - speedMin)
      this.#vx[i] = Math.cos(theta) * speed
      this.#vy[i] = Math.sin(theta) * speed
      this.#speed0[i] = speed
      this.#angle[i] = Math.random() * Math.PI * 2
      this.#spin[i] = (Math.random() * 2 - 1) * SPIN_MAX_RAD_PER_SEC
      this.#kind[i] = Math.random() < TRIANGLE_FRACTION ? 0 : 1
    }
  }

  override onUpdate(dt: number): void {
    if (dt <= 0) return
    this.#age += dt
    const damp = Math.exp(-DAMPING_PER_SEC * dt)
    const n = this.#count
    let maxSpeed = 0
    for (let i = 0; i < n; i++) {
      this.#vx[i] *= damp
      this.#vy[i] *= damp
      this.#x[i] += this.#vx[i] * dt
      this.#y[i] += this.#vy[i] * dt
      this.#angle[i] += this.#spin[i] * dt
      const sp = Math.hypot(this.#vx[i], this.#vy[i])
      if (sp > maxSpeed) maxSpeed = sp
    }
    // Not permanent: gone once every piece has slowed to a stop (or the cap).
    if (maxSpeed < this.#stopSpeed || this.#age >= MAX_LIFE_SEC) this.destroy()
  }

  override draw(gfx: Gfx2D, camera: Camera): void {
    const n = this.#count
    if (n === 0) return
    const side = this.#triangleSide
    const height = side * (Math.sqrt(3) / 2)
    const apexY = -height * (2 / 3)
    const baseY = height * (1 / 3)
    const halfBase = side * 0.5
    const lineHalf = this.#lineHalf
    const color = this.#color
    const lineStyle = {
      color,
      width: LINE_WIDTH_CSS_PX * camera.strokeSpaceScale(),
      cap: 'round' as const,
    }
    const tri = TRI_SCRATCH
    tri[0] = 0
    tri[1] = apexY
    tri[2] = halfBase
    tri[3] = baseY
    tri[4] = -halfBase
    tri[5] = baseY

    for (let i = 0; i < n; i++) {
      // Shrink with the piece's remaining speed so it dissolves as it slows.
      const scale = Math.min(
        1,
        Math.hypot(this.#vx[i], this.#vy[i]) / this.#speed0[i],
      )
      if (scale <= 0.02) continue
      gfx.save()
      gfx.translate(this.#x[i], this.#y[i])
      gfx.rotate(this.#angle[i])
      gfx.scale(scale, scale)
      if (this.#kind[i] === 0) {
        gfx.fillConvexPoly(tri, 3, color)
      } else {
        gfx.strokeLine(-lineHalf, 0, lineHalf, 0, lineStyle)
      }
      gfx.restore()
    }
  }
}
