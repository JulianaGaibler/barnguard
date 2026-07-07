import type { Vec2 } from '../math/Vec2'
import { ParticlePool } from './ParticlePool'
import type { ParticleSpriteStyle } from './draw'

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
   * sharp, non-bloomed particles (sparks, projectiles).
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
}

/**
 * Emits particles into a ParticlePool with baked kinematics:
 *
 * - Velocity integration
 * - Exponential damping
 * - Constant acceleration
 * - Life countdown
 *
 * The `draw` step (in `ParticleEmitterNode`) reads size + alpha curves off the
 * config to interpolate visual attributes across each particle's life.
 */
export class ParticleEmitter {
  readonly config: ParticleEmitterConfig
  readonly pool: ParticlePool
  originX = 0
  originY = 0
  private emitAccumulator = 0
  private readonly accelX: number
  private readonly accelY: number
  private readonly damping: number

  constructor(config: ParticleEmitterConfig) {
    this.config = { ...config }
    this.pool = new ParticlePool(config.capacity)
    this.accelX = config.accelerationWorld?.x ?? 0
    this.accelY = config.accelerationWorld?.y ?? 0
    this.damping = config.dampingPerSec ?? 0
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
      if (!this.emitOne(x, y, axisRad)) break
    }
  }

  /** Kill every live particle immediately. */
  clear(): void {
    this.pool.clear()
    this.emitAccumulator = 0
  }

  /**
   * Advance every live particle by `dt` and emit up to `ratePerSec * dt` new
   * particles from the current origin.
   */
  update(dt: number): void {
    if (dt <= 0) return
    // Continuous emission.
    if (this.config.ratePerSec > 0) {
      this.emitAccumulator += this.config.ratePerSec * dt
      const emitCount = Math.floor(this.emitAccumulator)
      if (emitCount > 0) {
        this.emitAccumulator -= emitCount
        for (let i = 0; i < emitCount; i++) {
          if (!this.emitOne(this.originX, this.originY)) break
        }
      }
    }

    // Physics + life countdown.
    const { x, y, vx, vy, life, alive } = this.pool.field
    const dampFactor = this.damping === 0 ? 1 : Math.exp(-this.damping * dt)
    const ax = this.accelX
    const ay = this.accelY
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
      // life
      life[i] -= dt
      if (life[i] <= 0) {
        this.pool.kill(i)
      }
    }
  }

  /**
   * Initialise a single particle slot. Returns `false` when the pool is
   * exhausted so callers can bail out of a burst loop early.
   */
  private emitOne(worldX: number, worldY: number, axisRad?: number): boolean {
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
    return true
  }
}
