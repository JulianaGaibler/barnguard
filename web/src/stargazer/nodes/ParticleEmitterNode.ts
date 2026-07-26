import { Node2D } from '../scene/Node2D'
import type { Camera } from '../camera/Camera'
import type { Gfx2D } from '../render/gfx/Gfx2D'
import {
  ParticleEmitter,
  type ParticleEmitterConfig,
} from '../particles/ParticleEmitter'
import { getParticleSprite } from '../particles/draw'

/**
 * Constructor options for {@link ParticleEmitterNode}.
 *
 * @category Nodes
 */
export interface ParticleEmitterNodeOptions {
  id?: string
  /** Emitter behavior and appearance. See {@link ParticleEmitterConfig}. */
  config: ParticleEmitterConfig
}

/**
 * Scene-graph wrapper around a {@link ParticleEmitter}. Advances the emitter in
 * {@link Node2D.onUpdate} and draws its sprites in {@link Node2D.draw}. Reach the
 * emitter through {@link ParticleEmitterNode.emitter} to emit, burst, or move
 * the origin.
 *
 * Particles live in the node's local coordinate space. `emitter.setOrigin(x,
 * y)` is a node-local point, so parenting this node under a moving object makes
 * the particles follow it; parenting it to `scene.root` (identity transform)
 * means the origin is world coordinates.
 *
 * @category Nodes
 * @example
 *   const trail = new ParticleEmitterNode({
 *     config: {
 *       capacity: 500,
 *       ratePerSec: 90,
 *       lifetimeSec: [0.5, 1.1],
 *       speedWorld: [10, 40],
 *       spreadRad: Math.PI,
 *       sizeWorld: [12, 24],
 *       palette: ['#ffd34d', '#ff8f6b'],
 *     },
 *   })
 *   scene.root.add(trail)
 *   trail.emitter.setOrigin(worldX, worldY) // update the emission point each frame
 */
export class ParticleEmitterNode extends Node2D {
  readonly emitter: ParticleEmitter

  constructor(opts: ParticleEmitterNodeOptions) {
    super(opts.id)
    this.emitter = new ParticleEmitter(opts.config)
    // Drains any pending `waitUntilEmpty()` resolver on destroy, so a caller
    // `await`ing it never hangs if the node is destroyed some other way
    // before the emitter naturally empties.
    this.abortSignal.addEventListener('abort', () => this.emitter.clear())
  }

  override get particleCount(): number {
    return this.emitter.aliveCount
  }

  override onUpdate(dt: number): void {
    this.emitter.update(dt)
  }

  override draw(gfx: Gfx2D, _camera: Camera, _dt: number): void {
    const cfg = this.emitter.config
    const pool = this.emitter.pool
    if (pool.aliveCount === 0) return

    const f = pool.field
    const hi = pool.highWaterIndex
    const palette = cfg.palette
    const scaleStart = cfg.scaleOverLife?.[0] ?? 1
    const scaleEnd = cfg.scaleOverLife?.[1] ?? 1
    const alphaStart = cfg.alphaOverLife?.[0] ?? 1
    const alphaEnd = cfg.alphaOverLife?.[1] ?? 0
    const scaleBySpeed = cfg.scaleBy === 'speed'
    // No spin range configured -> every particle's angle stays 0 -> always
    // take the bare-drawImage path below. Non-rotating emitters pay nothing
    // extra for this feature.
    const mayRotate =
      cfg.spinRadPerSec !== undefined &&
      (cfg.spinRadPerSec[0] !== 0 || cfg.spinRadPerSec[1] !== 0)

    // save/restore snapshots blend + alpha (and transform); the emitter sets an
    // additive blend and per-particle alpha, then restores the Stage-installed
    // node baseline on exit.
    gfx.save()
    gfx.setBlend(cfg.blend ?? 'lighter')

    for (let i = 0; i < hi; i++) {
      if (f.alive[i] === 0) continue
      const maxLife = f.maxLife[i]
      const lifeT = maxLife > 0 ? 1 - f.life[i] / maxLife : 1
      let t = lifeT
      if (scaleBySpeed) {
        const speed0 = f.speed0[i]
        const speedRatio =
          speed0 > 0 ? Math.min(1, Math.hypot(f.vx[i], f.vy[i]) / speed0) : 0
        t = 1 - speedRatio
      }
      // Alpha always fades on the lifetime clock, even when scale is
      // speed-driven — matches every hand-rolled burst this replaces, which
      // shrinks to near-zero scale and stops drawing rather than fading out.
      const alpha = alphaStart + (alphaEnd - alphaStart) * lifeT
      if (alpha <= 0) continue
      const scale = scaleStart + (scaleEnd - scaleStart) * t
      const size = f.size[i] * scale
      if (size <= 0) continue
      const half = size * 0.5
      const sprite = getParticleSprite(palette[f.colorIdx[i]], cfg.spriteStyle)
      gfx.setAlpha(alpha)
      if (mayRotate && f.angle[i] !== 0) {
        gfx.save()
        gfx.translate(f.x[i], f.y[i])
        gfx.rotate(f.angle[i])
        gfx.drawImage(sprite, -half, -half, size, size)
        gfx.restore()
      } else {
        gfx.drawImage(sprite, f.x[i] - half, f.y[i] - half, size, size)
      }
    }

    gfx.restore()
  }
}
