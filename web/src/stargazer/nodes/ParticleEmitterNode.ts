import { SceneNode } from '../scene/SceneNode'
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
 * {@link SceneNode.onUpdate} and draws its sprites in {@link SceneNode.draw}.
 * Reach the emitter through {@link ParticleEmitterNode.emitter} to emit, burst,
 * or move the origin.
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
export class ParticleEmitterNode extends SceneNode {
  readonly emitter: ParticleEmitter

  constructor(opts: ParticleEmitterNodeOptions) {
    super(opts.id)
    this.emitter = new ParticleEmitter(opts.config)
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

    // save/restore snapshots blend + alpha (and transform); the emitter sets an
    // additive blend and per-particle alpha, then restores the Stage-installed
    // node baseline on exit.
    gfx.save()
    gfx.setBlend(cfg.blend ?? 'lighter')

    for (let i = 0; i < hi; i++) {
      if (f.alive[i] === 0) continue
      const maxLife = f.maxLife[i]
      const t = maxLife > 0 ? 1 - f.life[i] / maxLife : 1
      const alpha = alphaStart + (alphaEnd - alphaStart) * t
      if (alpha <= 0) continue
      const scale = scaleStart + (scaleEnd - scaleStart) * t
      const size = f.size[i] * scale
      if (size <= 0) continue
      const half = size * 0.5
      const color = palette[f.colorIdx[i]]
      gfx.setAlpha(alpha)
      gfx.drawImage(
        getParticleSprite(color, cfg.spriteStyle),
        f.x[i] - half,
        f.y[i] - half,
        size,
        size,
      )
    }

    gfx.restore()
  }
}
