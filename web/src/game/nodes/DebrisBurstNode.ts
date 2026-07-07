import { SceneNode, type Camera, type Gfx2D, type Vec2 } from '@src/stargazer'

/** Reused scratch for the per-piece equilateral triangle (draw is synchronous). */
const DEBRIS_TRI_SCRATCH = new Float32Array(6)

export interface DebrisBurstOptions {
  /** World-space centre, every particle starts here in local coords. */
  center: Vec2
  /** Total pieces (mix of triangles + lines). */
  count: number
  /** Fraction of the pool rendered as triangles; the rest are lines. */
  triangleFraction: number
  /** Random initial outward speed range (world units / sec). */
  initialSpeedWorld: readonly [number, number]
  /** Translational drag, `v(t) = v0 * exp(-damping * t)`. */
  dampingPerSec: number
  /**
   * Cone axis for the initial velocity direction (radians). Leave undefined for
   * radial 360° emission (`emitSpreadRad` is ignored in that case).
   */
  emitDirectionRad?: number
  /** Cone half-angle around `emitDirectionRad`. Ignored when radial. */
  emitSpreadRad?: number
  /**
   * If set, each piece's starting rotation is `velocityHeading +
   * initialAngleOffsetRad` (so the pieces launch with a consistent relationship
   * to their flight direction, e.g., `π/2` aligns them broadside like wall
   * shards flung perpendicular to a projectile). If undefined, each piece gets
   * a uniform random start angle. Independent of the spin fields below, the
   * piece STILL rotates over time from the transient + base spin, this only
   * sets its initial pose.
   */
  initialAngleOffsetRad?: number
  /**
   * Transient spin range at launch (rad/s). Decays via
   * `angInitialDampingPerSec` to zero over ~1 s. Use `[0, 0]` to skip.
   */
  angInitialRadPerSec: readonly [number, number]
  angInitialDampingPerSec: number
  /**
   * Permanent slow-spin magnitude range (rad/s). Random ± sign is applied per
   * piece so no piece freezes. Use `[0, 0]` for no residual rotation.
   */
  angBaseAbsRadPerSec: readonly [number, number]
  /** Triangle side length (world units), an equilateral filled tri. */
  triangleSideWorld: number
  /** Line segment length (world units). */
  lineLengthWorld: number
  /** Line stroke width in CSS pixels, screen-space-scaled at draw. */
  lineWidthCssPx: number
  /** Fill / stroke colour. */
  color: string
  /**
   * When true, radial emission angles are evenly spaced around the circle (`i /
   * count * 2π`) with a small random jitter, so the settled ring reads as
   * visibly even spacing rather than a random scatter with visible clumps +
   * gaps. Ignored when `emitDirectionRad` is set (cone emission stays random
   * within the cone). Default: `false`, the live game keeps the random-scatter
   * feel.
   */
  equidistantEmission?: boolean
}

/**
 * A one-shot burst of debris pieces (mix of filled triangles + stroked lines)
 * that spawns at `center`, integrates outward under exponential drag, and
 * settles into a permanent ring after a fraction of a second.
 *
 * The two loss-animation flavours (collision explosion + border breach) are the
 * same node with different `DebrisBurstOptions`:
 *
 * - **Collision**, radial 360° emission, mix of triangles + lines, random
 *   rotation with a permanent slow residual spin.
 * - **Border breach**, narrow cone along the packet's exit velocity, lines only,
 *   launch-orientation matches each piece's velocity, no spin.
 *
 * Storage is parallel `Float32Array` / `Uint8Array` fields, one slot per piece.
 * No per-frame allocations after construction. Life is unbounded; the session
 * destroys the node during `reset` as part of clearing every round visual.
 */
export class DebrisBurstNode extends SceneNode {
  private readonly count: number
  private readonly x: Float32Array
  private readonly y: Float32Array
  private readonly vx: Float32Array
  private readonly vy: Float32Array
  private readonly angle: Float32Array
  /** Transient spin, decays via `angInitialDampingPerSec`. */
  private readonly angInitial: Float32Array
  /** Permanent slow spin, total spin = angBase + angInitial. */
  private readonly angBase: Float32Array
  /** 0 = triangle, 1 = line. */
  private readonly kind: Uint8Array

  private readonly damping: number
  private readonly angDamping: number
  private readonly triangleSide: number
  private readonly lineHalf: number
  private readonly lineWidthCssPx: number
  private readonly color: string

  constructor(opts: DebrisBurstOptions) {
    super('debris-burst')
    const n = opts.count
    this.count = n
    this.x = new Float32Array(n)
    this.y = new Float32Array(n)
    this.vx = new Float32Array(n)
    this.vy = new Float32Array(n)
    this.angle = new Float32Array(n)
    this.angInitial = new Float32Array(n)
    this.angBase = new Float32Array(n)
    this.kind = new Uint8Array(n)
    this.damping = opts.dampingPerSec
    this.angDamping = opts.angInitialDampingPerSec
    this.triangleSide = opts.triangleSideWorld
    this.lineHalf = opts.lineLengthWorld * 0.5
    this.lineWidthCssPx = opts.lineWidthCssPx
    this.color = opts.color

    this.transform.x = opts.center.x
    this.transform.y = opts.center.y

    const [speedMin, speedMax] = opts.initialSpeedWorld
    const [angInitMin, angInitMax] = opts.angInitialRadPerSec
    const [angBaseAbsMin, angBaseAbsMax] = opts.angBaseAbsRadPerSec
    const triFrac = opts.triangleFraction
    const dirAxis = opts.emitDirectionRad
    const dirSpread = opts.emitSpreadRad ?? 0
    const angleOffset = opts.initialAngleOffsetRad
    const equidistant = opts.equidistantEmission === true
    // Jitter is a fraction of the per-piece angular slot, big enough to
    // avoid a mechanical look, small enough that even spacing still reads.
    const equidistantSlot = (Math.PI * 2) / n
    const equidistantJitter = equidistantSlot * 0.3

    for (let i = 0; i < n; i++) {
      // Emit direction: radial (random or evenly-spaced with jitter) when
      // no axis is set, else uniform cone.
      const theta =
        dirAxis === undefined
          ? equidistant
            ? i * equidistantSlot + (Math.random() * 2 - 1) * equidistantJitter
            : Math.random() * Math.PI * 2
          : dirAxis + (Math.random() * 2 - 1) * dirSpread
      const speed = speedMin + Math.random() * (speedMax - speedMin)
      this.x[i] = 0
      this.y[i] = 0
      this.vx[i] = Math.cos(theta) * speed
      this.vy[i] = Math.sin(theta) * speed

      // Initial pose: offset from velocity heading, or fully random.
      this.angle[i] =
        angleOffset !== undefined
          ? theta + angleOffset
          : Math.random() * Math.PI * 2
      // Spin is decoupled from initial pose, always applied from the
      // config ranges (which may be all-zero to skip).
      this.angInitial[i] =
        angInitMin + Math.random() * (angInitMax - angInitMin)
      // Base spin sampled as magnitude × random sign so pieces don't
      // asymptote to zero rotation. When the range is `[0, 0]`, sign is
      // still ±1 but magnitude is 0, so `angBase` stays 0.
      const baseSign = Math.random() < 0.5 ? -1 : 1
      const baseMag =
        angBaseAbsMin + Math.random() * (angBaseAbsMax - angBaseAbsMin)
      this.angBase[i] = baseSign * baseMag
      this.kind[i] = Math.random() < triFrac ? 0 : 1
    }
  }

  override onUpdate(dt: number): void {
    if (dt <= 0) return
    const n = this.count
    const dampFactor = Math.exp(-this.damping * dt)
    const angDampFactor =
      this.angDamping > 0 ? Math.exp(-this.angDamping * dt) : 1
    for (let i = 0; i < n; i++) {
      this.vx[i] *= dampFactor
      this.vy[i] *= dampFactor
      this.x[i] += this.vx[i] * dt
      this.y[i] += this.vy[i] * dt
      this.angle[i] += (this.angBase[i] + this.angInitial[i]) * dt
      this.angInitial[i] *= angDampFactor
    }
  }

  override draw(gfx: Gfx2D, camera: Camera, _dt: number): void {
    const n = this.count
    if (n === 0) return
    const side = this.triangleSide
    const height = side * (Math.sqrt(3) / 2)
    const apexY = -height * (2 / 3)
    const baseY = height * (1 / 3)
    const halfBase = side * 0.5
    const lineHalf = this.lineHalf
    const color = this.color
    const lineStyle = {
      color,
      width: this.lineWidthCssPx * camera.strokeSpaceScale(),
      cap: 'round' as const,
    }
    const tri = DEBRIS_TRI_SCRATCH
    tri[0] = 0
    tri[1] = apexY
    tri[2] = halfBase
    tri[3] = baseY
    tri[4] = -halfBase
    tri[5] = baseY

    for (let i = 0; i < n; i++) {
      gfx.save()
      gfx.translate(this.x[i], this.y[i])
      gfx.rotate(this.angle[i])
      if (this.kind[i] === 0) {
        gfx.fillConvexPoly(tri, 3, color)
      } else {
        gfx.strokeLine(-lineHalf, 0, lineHalf, 0, lineStyle)
      }
      gfx.restore()
    }
  }
}
