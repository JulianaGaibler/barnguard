import type { Vec2 } from '../math/Vec2'
import { ParticlePool } from './ParticlePool'
import type { ParticleSpriteStyle } from './draw'

/**
 * Behavior and appearance of a {@link ParticleEmitter}: spawn rate, kinematics,
 * and the size/alpha curves each particle follows over its life.
 *
 * @category Particles
 */
export interface ParticleEmitterConfig {
  /** Maximum number of live particles at once. */
  capacity: number
  /** Continuous emissions per second; set to 0 for one-shot bursts only. */
  ratePerSec: number
  /** Random particle lifespan range, in seconds. */
  lifetimeSec: readonly [number, number]
  /** Random initial speed range, in world units per second. */
  speedWorld: readonly [number, number]
  /** Half-angle of the emission cone (radians). PI = full 180°. */
  spreadRad: number
  /**
   * Cone axis in radians (0 = +x). Leave undefined for a full radial 360°
   * emission (`spreadRad` is ignored in that case).
   */
  emitDirectionRad?: number
  /** Random initial size range, in world units. */
  sizeWorld: readonly [number, number]
  /** Palette of hex colors, particles pick one uniformly at random. */
  palette: readonly string[]
  /**
   * Sprite shape: `'gradient'` (default), soft radial fade; pair with `blend:
   * 'lighter'` for classic bloom, or `blend: 'source-over'` for a softer glow.
   * `'disc'`, solid disc with an AA edge; pair with `blend: 'source-over'` for
   * sharp, non-bloomed particles (sparks, projectiles). `'hexagon'` and
   * `'square'`, solid flat shapes with the same AA margin, for crisp debris or
   * data-style trails under `blend: 'source-over'`.
   */
  spriteStyle?: ParticleSpriteStyle
  /** Canvas composite mode. Default `'lighter'`, additive bloom. */
  blend?: GlobalCompositeOperation
  /** Exponential drag coefficient per second. 0 = no damping. */
  dampingPerSec?: number
  /** Constant acceleration in world units / sec² (gravity, wind, …). */
  accelerationWorld?: Vec2
  /** Multiplier applied to `size` over life (spawn → death). Default [1, 1]. */
  scaleOverLife?: readonly [number, number]
  /** Alpha over life (spawn → death). Default [1, 0]. */
  alphaOverLife?: readonly [number, number]
  /**
   * Random per-particle constant angular velocity range, rad/s, e.g. `[-6, 6]`
   * for a symmetric tumble (like every other `[min, max]` range in this config,
   * pass a negative min for a range that straddles zero — this one is sampled
   * with its sign, not folded to a magnitude). Sampled once at spawn,
   * integrated every frame (`angle += spin * dt`), applied at draw time as a
   * sprite rotation. Omit (default) for no rotation —
   * `ParticleEmitterNode.draw` then skips the rotate transform entirely, so
   * non-rotating emitters pay nothing extra.
   */
  spinRadPerSec?: readonly [number, number]
  /**
   * What drives the `scaleOverLife` interpolation. `'life'` (default): the
   * usual `t = 1 - life/maxLife`. `'speed'`: drives the SAME curve by `1 -
   * clamp(currentSpeed / speed0, 0, 1)` instead, so a particle still moving
   * fast reads at `scaleOverLife[0]` and one that's nearly stopped reads at
   * `scaleOverLife[1]`, regardless of remaining lifetime — use this for a burst
   * that should visually dissolve as it decelerates rather than on a fixed
   * clock. `alphaOverLife` always stays life-driven.
   */
  scaleBy?: 'life' | 'speed'
  /**
   * Opt-in early despawn: once a particle's current speed drops below
   * `minSpeedFrac * speed0` (its own launch speed), it's killed even if `life`
   * hasn't run out. Unset (default) disables this — particles only die from
   * `life <= 0`. `lifetimeSec`'s upper bound remains the safety backstop either
   * way.
   */
  minSpeedFrac?: number
}

/**
 * A pooled particle system. Allocates {@link ParticleEmitterConfig.capacity}
 * particles up front, then emits and integrates them allocation-free. Drive it
 * two ways: a continuous stream ({@link ParticleEmitter.setOrigin} plus a
 * non-zero `ratePerSec`) and one-shot {@link ParticleEmitter.burst} calls. The
 * two run together.
 *
 * {@link ParticleEmitter.update} advances each live particle every frame with
 * velocity integration, exponential damping, constant acceleration, and a life
 * countdown. The draw step (in `ParticleEmitterNode`) reads the size and alpha
 * curves off the config to fade a particle over its life.
 *
 * Usually you build a `ParticleEmitterNode` and reach this through its
 * `emitter` field rather than constructing it directly.
 *
 * @category Particles
 * @example
 *   // One-shot explosion at a world point.
 *   node.emitter.burst(200, worldX, worldY)
 */
export class ParticleEmitter {
  readonly config: ParticleEmitterConfig
  readonly pool: ParticlePool
  originX = 0
  originY = 0
  #emitAccumulator = 0
  readonly #accelX: number
  readonly #accelY: number
  readonly #damping: number
  readonly #spinMin: number
  readonly #spinMax: number
  readonly #minSpeedFrac: number
  #emptyResolvers: Array<() => void> = []

  constructor(config: ParticleEmitterConfig) {
    this.config = { ...config }
    this.pool = new ParticlePool(config.capacity)
    this.#accelX = config.accelerationWorld?.x ?? 0
    this.#accelY = config.accelerationWorld?.y ?? 0
    this.#damping = config.dampingPerSec ?? 0
    this.#spinMin = config.spinRadPerSec?.[0] ?? 0
    this.#spinMax = config.spinRadPerSec?.[1] ?? 0
    this.#minSpeedFrac = config.minSpeedFrac ?? 0
  }

  get aliveCount(): number {
    return this.pool.aliveCount
  }

  /** Point the continuous stream at a new world position. */
  setOrigin(x: number, y: number): void {
    this.originX = x
    this.originY = y
  }

  /** Emit `count` particles at (x, y) NOW (bypasses ratePerSec). */
  burst(count: number, x: number, y: number, axisRad?: number): void {
    for (let i = 0; i < count; i++) {
      if (!this.#emitOne(x, y, axisRad)) break
    }
  }

  /** Kill every live particle immediately. */
  clear(): void {
    this.pool.clear()
    this.#emitAccumulator = 0
    this.#drainEmptyResolvers()
  }

  /**
   * Resolves once `aliveCount` is 0 — immediately if it already is at call
   * time, else the next time it reaches 0 (checked at the tail of every
   * `update(dt)` and `clear()`, so it fires the same frame the last particle
   * dies — no polling). Call this RIGHT AFTER the `burst()` you want to wait
   * for, in the same synchronous span (no `await` between them): JS's
   * single-threaded execution then guarantees no `update()` tick runs in
   * between, so `aliveCount` still reflects the burst you just triggered.
   * Typical one-shot-burst idiom:
   * `node.autoDestroy(node.emitter.waitUntilEmpty())`. This method has no
   * per-burst identity — pair it with the specific burst it should track, not
   * with reuse across unrelated later bursts, or it may observe a stale
   * "already empty" left over from a previous cycle.
   */
  waitUntilEmpty(): Promise<void> {
    if (this.pool.aliveCount === 0) return Promise.resolve()
    return new Promise((resolve) => {
      this.#emptyResolvers.push(resolve)
    })
  }

  #drainEmptyResolvers(): void {
    if (this.#emptyResolvers.length === 0 || this.pool.aliveCount !== 0) return
    const resolvers = this.#emptyResolvers
    this.#emptyResolvers = []
    for (const resolve of resolvers) resolve()
  }

  /**
   * Advance every live particle by `dt` and emit up to `ratePerSec * dt` new
   * particles from the current origin.
   */
  update(dt: number): void {
    if (dt <= 0) return
    // Continuous emission.
    if (this.config.ratePerSec > 0) {
      this.#emitAccumulator += this.config.ratePerSec * dt
      const emitCount = Math.floor(this.#emitAccumulator)
      if (emitCount > 0) {
        this.#emitAccumulator -= emitCount
        for (let i = 0; i < emitCount; i++) {
          if (!this.#emitOne(this.originX, this.originY)) break
        }
      }
    }

    // Physics + life countdown.
    const { x, y, vx, vy, life, alive, angle, spin, speed0 } = this.pool.field
    const dampFactor = this.#damping === 0 ? 1 : Math.exp(-this.#damping * dt)
    const ax = this.#accelX
    const ay = this.#accelY
    const minSpeedFrac = this.#minSpeedFrac
    const hi = this.pool.highWaterIndex
    for (let i = 0; i < hi; i++) {
      if (alive[i] === 0) continue
      // v *= exp(-damp*dt)
      vx[i] *= dampFactor
      vy[i] *= dampFactor
      // v += a*dt
      vx[i] += ax * dt
      vy[i] += ay * dt
      // p += v*dt
      x[i] += vx[i] * dt
      y[i] += vy[i] * dt
      // rotation
      angle[i] += spin[i] * dt
      // opt-in early despawn once this particle's own speed ratio has decayed
      if (minSpeedFrac > 0 && speed0[i] > 0) {
        const curSpeed = Math.hypot(vx[i], vy[i])
        if (curSpeed < minSpeedFrac * speed0[i]) {
          this.pool.kill(i)
          continue
        }
      }
      // life
      life[i] -= dt
      if (life[i] <= 0) {
        this.pool.kill(i)
      }
    }
    this.#drainEmptyResolvers()
  }

  /**
   * Initialise a single particle slot. Returns `false` when the pool is
   * exhausted so callers can bail out of a burst loop early.
   */
  #emitOne(worldX: number, worldY: number, axisRad?: number): boolean {
    const idx = this.pool.spawn()
    if (idx < 0) return false
    const cfg = this.config
    const [lifeMin, lifeMax] = cfg.lifetimeSec
    const [speedMin, speedMax] = cfg.speedWorld
    const [sizeMin, sizeMax] = cfg.sizeWorld
    const life = lifeMin + Math.random() * (lifeMax - lifeMin)
    const speed = speedMin + Math.random() * (speedMax - speedMin)
    const size = sizeMin + Math.random() * (sizeMax - sizeMin)

    const axis = axisRad ?? cfg.emitDirectionRad
    let angle: number
    if (axis === undefined) {
      angle = Math.random() * Math.PI * 2
    } else {
      angle = axis + (Math.random() * 2 - 1) * cfg.spreadRad
    }

    const f = this.pool.field
    f.x[idx] = worldX
    f.y[idx] = worldY
    f.vx[idx] = Math.cos(angle) * speed
    f.vy[idx] = Math.sin(angle) * speed
    f.life[idx] = life
    f.maxLife[idx] = life
    f.size[idx] = size
    f.colorIdx[idx] = Math.floor(Math.random() * cfg.palette.length)
    f.angle[idx] = 0
    f.spin[idx] =
      this.#spinMin + Math.random() * (this.#spinMax - this.#spinMin)
    f.speed0[idx] = speed
    return true
  }
}
