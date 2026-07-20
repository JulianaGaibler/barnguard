import { SceneNode, type Camera, type Gfx2D, type Vec2 } from '@src/stargazer'
import { tessellateContours } from '@src/stargazer/assets/SvgPathContours'
import { registerPathTessellation } from '@src/stargazer/render/gfx/PathTessellationRegistry'

export interface PacketSpawnConvergeOptions {
  center: Vec2
  /** Particles spawned per second while the emitter is active. */
  ratePerSec: number
  /** How long to keep spawning particles (seconds). */
  spawnDurationSec: number
  /** Each particle's individual lifespan (seconds). */
  particleLifetimeSec: number
  /** Radius the particle starts at (world units). */
  ringRadiusWorld: number
  /**
   * Final radius as a fraction of `ringRadiusWorld`. `0.18` means each particle
   * dies at 18 % of the ring radius from the centre, it never reaches the
   * middle. Reads as "converging energy that dissolves before it lands".
   */
  radiusEndFraction: number
  /** Peak world-space size at end of life. Particles start at scale 0. */
  sizeMaxWorld: number
  /**
   * Fraction of life spent ramping alpha 0 → 1. Remainder is a quick fade to 0.
   * So the particle starts invisible, becomes progressively more opaque as it
   * moves inward, then briefly dips out at the end.
   */
  alphaGrowFraction: number
  color: string
}

/**
 * Continuous hex-particle emitter that plays during the packet's grow-in
 * animation. Each particle independently:
 *
 * 1. Spawns at a random angle on the ring (`ringRadiusWorld` from centre) at scale
 *    0, alpha 0.
 * 2. Eases inward (quadratic) toward `ringRadiusWorld * radiusEndFraction`.
 * 3. Grows linearly from scale 0 → `sizeMaxWorld`.
 * 4. Alpha ramps from 0 → 1 over the first `alphaGrowFraction` of its life, then
 *    quick-fades to 0 for the remainder.
 * 5. Dies before reaching the centre, the packet's own grow tween owns the middle
 *    of the animation.
 *
 * Emission stops after `spawnDurationSec`; remaining live particles finish
 * their lives, then the node self-destroys. Storage is a fixed pool of
 * `Float32Array` + `Uint8Array`, no per-frame allocations.
 */
export class PacketSpawnConvergeNode extends SceneNode {
  readonly #ratePerSec: number
  readonly #spawnDuration: number
  readonly #lifetime: number
  readonly #ringRadius: number
  readonly #radiusEndFraction: number
  readonly #sizeMax: number
  readonly #alphaGrowFraction: number
  readonly #color: string

  readonly #capacity: number
  readonly #angle: Float32Array
  readonly #age: Float32Array
  readonly #active: Uint8Array
  #nextSlot = 0
  #spawnAccumulator = 0
  #elapsedSec = 0
  #aliveCount = 0

  readonly #hexPath: Path2D

  constructor(opts: PacketSpawnConvergeOptions) {
    super('packet-spawn-converge')
    this.transform.x = opts.center.x
    this.transform.y = opts.center.y
    this.#ratePerSec = opts.ratePerSec
    this.#spawnDuration = opts.spawnDurationSec
    this.#lifetime = opts.particleLifetimeSec
    this.#ringRadius = opts.ringRadiusWorld
    this.#radiusEndFraction = opts.radiusEndFraction
    this.#sizeMax = opts.sizeMaxWorld
    this.#alphaGrowFraction = opts.alphaGrowFraction
    this.#color = opts.color

    // Pool size sized for the peak simultaneous alive count with a small
    // buffer, `ratePerSec * lifetime + 4` covers the steady-state plus
    // rounding slack from the emission accumulator.
    this.#capacity = Math.max(
      4,
      Math.ceil(this.#ratePerSec * this.#lifetime) + 4,
    )
    this.#angle = new Float32Array(this.#capacity)
    this.#age = new Float32Array(this.#capacity)
    this.#active = new Uint8Array(this.#capacity)

    this.#hexPath = buildUnitHexagonPath()
  }

  override onUpdate(dt: number): void {
    if (dt <= 0) return
    this.#elapsedSec += dt

    // Spawn while the emitter is active. Fractional accumulator ensures
    // the target rate is hit precisely regardless of frame timing.
    if (this.#elapsedSec < this.#spawnDuration) {
      this.#spawnAccumulator += this.#ratePerSec * dt
      while (this.#spawnAccumulator >= 1) {
        this.#spawnAccumulator -= 1
        this.#spawnOne()
      }
    }

    // Advance ages; deactivate on expiry.
    const cap = this.#capacity
    for (let i = 0; i < cap; i++) {
      if (!this.#active[i]) continue
      this.#age[i] += dt
      if (this.#age[i] >= this.#lifetime) {
        this.#active[i] = 0
        this.#aliveCount--
      }
    }

    // Self-destroy once emission has ended AND no particles remain alive.
    if (
      this.#elapsedSec >= this.#spawnDuration &&
      this.#aliveCount <= 0 &&
      !this.isDestroyed
    ) {
      this.destroy()
    }
  }

  #spawnOne(): void {
    // Ring-scan slot allocation. In steady state the capacity is sized so
    // the oldest slot is already expired by the time we wrap around, so
    // overwriting is safe. Guard defensively just in case a burst pushes
    // us up against the ceiling.
    const cap = this.#capacity
    let slot = this.#nextSlot
    for (let tries = 0; tries < cap; tries++) {
      if (!this.#active[slot]) break
      slot = (slot + 1) % cap
    }
    if (this.#active[slot]) {
      // Pool full, silently drop this spawn. Prefer visible truncation
      // over overwriting an in-flight particle mid-life.
      return
    }
    this.#active[slot] = 1
    this.#age[slot] = 0
    this.#angle[slot] = Math.random() * Math.PI * 2
    this.#nextSlot = (slot + 1) % cap
    this.#aliveCount++
  }

  override draw(gfx: Gfx2D, _camera: Camera): void {
    const cap = this.#capacity
    const rStart = this.#ringRadius
    const rEnd = this.#ringRadius * this.#radiusEndFraction
    const sizeMax = this.#sizeMax
    const growFrac = this.#alphaGrowFraction
    const invGrow = growFrac > 0 ? 1 / growFrac : 1
    const invFade = growFrac < 1 ? 1 / (1 - growFrac) : 1
    const color = this.#color

    for (let i = 0; i < cap; i++) {
      if (!this.#active[i]) continue
      const t = this.#age[i] / this.#lifetime
      if (t >= 1) continue
      // Quad-in radial ease, particles start slow near the ring and
      // accelerate as they rush inward.
      const eased = t * t
      const r = rStart + (rEnd - rStart) * eased
      const size = sizeMax * t
      const alpha =
        t < growFrac ? t * invGrow : Math.max(0, 1 - (t - growFrac) * invFade)
      if (alpha <= 0 || size <= 0) continue
      const a = this.#angle[i]
      const x = Math.cos(a) * r
      const y = Math.sin(a) * r
      gfx.save()
      gfx.setAlpha(alpha)
      gfx.translate(x, y)
      gfx.scale(size, size)
      gfx.fillPath2D(this.#hexPath, color)
      gfx.restore()
    }
  }
}

/**
 * Regular flat-topped hexagon at unit radius. Drawn once at construction. *
 * consumers `ctx.scale(size, size)` to render at any world size without
 * rebuilding the Path2D. Mirrors `PacketNode`'s geometry so ring particles read
 * as the same shape family as the packet itself.
 */
function buildUnitHexagonPath(): Path2D {
  const p = new Path2D()
  const contour = new Float32Array(12)
  for (let i = 0; i < 6; i++) {
    const a = (Math.PI / 3) * i - Math.PI / 6
    const x = Math.cos(a)
    const y = Math.sin(a)
    contour[i * 2] = x
    contour[i * 2 + 1] = y
    if (i === 0) p.moveTo(x, y)
    else p.lineTo(x, y)
  }
  p.closePath()
  const triangles = tessellateContours([contour])
  registerPathTessellation(p, triangles, [contour])
  return p
}
