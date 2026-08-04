import {
  VectorParticleNode,
  type CameraView2D,
  type Gfx2D,
  type Vec2,
  type VectorParticleSpawnInit,
} from '@src/stargazer'

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
   * If set, each piece launches at `velocityHeading + initialAngleOffsetRad`.
   * `π/2` = broadside to flight direction. Undefined = uniform random. Spin
   * fields still apply on top of this.
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
  /** Fill / stroke color. */
  color: string
  /**
   * Evenly-spaced radial emission with small jitter, no clumps or gaps. Ignored
   * when `emitDirectionRad` is set. Default false.
   */
  equidistantEmission?: boolean
}

/**
 * One-shot debris burst (triangles + lines). Integrates outward under
 * exponential drag, settles into a permanent ring within ~1 s — deliberately
 * never shrinks or despawns (`shouldDespawn` is left at `VectorParticleNode`'s
 * default), cleaned up externally by the session's level-reset sweep, not by
 * self-destruction. Two flavours driven by `DebrisBurstOptions`, radial
 * collision explosion vs cone border breach. Parallel typed-array storage, zero
 * per-frame allocation.
 */
export class DebrisBurstNode extends VectorParticleNode {
  /** Transient spin, decays via `angInitialDampingPerSec`. */
  readonly #angInitial: Float32Array
  /** Permanent slow spin, total spin = angBase + angInitial. */
  readonly #angBase: Float32Array
  /** 0 = triangle, 1 = line. */
  readonly #kind: Uint8Array

  readonly #angDamping: number
  readonly #triangleSide: number
  readonly #lineHalf: number
  readonly #lineWidthCssPx: number
  readonly #color: string

  // Options are read back from `spawnParticle`, called synchronously by
  // `burst()`; `#pendingTheta` is staged per-iteration ahead of each `burst(1)`
  // call, since emission angle depends on the loop index.
  readonly #opts: DebrisBurstOptions
  #pendingTheta = 0

  constructor(opts: DebrisBurstOptions) {
    super({
      id: 'debris-burst',
      capacity: opts.count,
      dampingPerSec: opts.dampingPerSec,
    })
    const n = opts.count
    this.#angInitial = new Float32Array(n)
    this.#angBase = new Float32Array(n)
    this.#kind = new Uint8Array(n)
    this.#angDamping = opts.angInitialDampingPerSec
    this.#triangleSide = opts.triangleSideWorld
    this.#lineHalf = opts.lineLengthWorld * 0.5
    this.#lineWidthCssPx = opts.lineWidthCssPx
    this.#color = opts.color
    this.transform.x = opts.center.x
    this.transform.y = opts.center.y
    this.#opts = opts

    const dirAxis = opts.emitDirectionRad
    const dirSpread = opts.emitSpreadRad ?? 0
    const equidistant = opts.equidistantEmission === true
    // Jitter is a fraction of the per-piece angular slot, big enough to
    // avoid a mechanical look, small enough that even spacing still reads.
    const equidistantSlot = (Math.PI * 2) / n
    const equidistantJitter = equidistantSlot * 0.3

    for (let i = 0; i < n; i++) {
      // Emit direction: radial (random or evenly-spaced with jitter) when
      // no axis is set, else uniform cone.
      this.#pendingTheta =
        dirAxis === undefined
          ? equidistant
            ? i * equidistantSlot + (Math.random() * 2 - 1) * equidistantJitter
            : Math.random() * Math.PI * 2
          : dirAxis + (Math.random() * 2 - 1) * dirSpread
      this.burst(1)
    }
  }

  protected override spawnParticle(
    i: number,
    out: VectorParticleSpawnInit,
  ): void {
    const opts = this.#opts
    const theta = this.#pendingTheta
    const [speedMin, speedMax] = opts.initialSpeedWorld
    const [angInitMin, angInitMax] = opts.angInitialRadPerSec
    const [angBaseAbsMin, angBaseAbsMax] = opts.angBaseAbsRadPerSec
    const speed = speedMin + Math.random() * (speedMax - speedMin)

    out.x = 0
    out.y = 0
    out.vx = Math.cos(theta) * speed
    out.vy = Math.sin(theta) * speed
    out.speed0 = speed
    // Initial pose: offset from velocity heading, or fully random.
    out.angle =
      opts.initialAngleOffsetRad !== undefined
        ? theta + opts.initialAngleOffsetRad
        : Math.random() * Math.PI * 2

    // Spin is decoupled from initial pose, always applied from the config
    // ranges (which may be all-zero to skip).
    this.#angInitial[i] = angInitMin + Math.random() * (angInitMax - angInitMin)
    // Base spin sampled as magnitude × random sign so pieces don't asymptote
    // to zero rotation. When the range is `[0, 0]`, sign is still ±1 but
    // magnitude is 0, so `angBase` stays 0.
    const baseSign = Math.random() < 0.5 ? -1 : 1
    const baseMag =
      angBaseAbsMin + Math.random() * (angBaseAbsMax - angBaseAbsMin)
    this.#angBase[i] = baseSign * baseMag
    this.#kind[i] = Math.random() < opts.triangleFraction ? 0 : 1
  }

  protected override updateExtra(i: number, dt: number): void {
    const angDampFactor =
      this.#angDamping > 0 ? Math.exp(-this.#angDamping * dt) : 1
    this.angle[i] += (this.#angBase[i] + this.#angInitial[i]) * dt
    this.#angInitial[i] *= angDampFactor
  }

  // `shouldDespawn` intentionally NOT overridden — these pieces settle into a
  // permanent ring, cleaned up externally (see class doc comment).

  protected override drawParticle(
    gfx: Gfx2D,
    i: number,
    camera: CameraView2D,
  ): void {
    if (this.#kind[i] === 0) {
      const side = this.#triangleSide
      const height = side * (Math.sqrt(3) / 2)
      const tri = DEBRIS_TRI_SCRATCH
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
        width: this.#lineWidthCssPx * camera.strokeSpaceScale(),
        cap: 'round',
      })
    }
  }
}
