import { SceneNode } from '../scene/SceneNode'
import type { Camera } from '../camera/Camera'
import type { Gfx2D } from '../render/gfx/Gfx2D'
import {
  ParticleEmitter,
  type ParticleEmitterConfig,
} from '../particles/ParticleEmitter'
import { getParticleSprite } from '../particles/draw'

export interface ParticleEmitterNodeOptions {
  id?: string
  config: ParticleEmitterConfig
}

/**
 * Scene-graph wrapper around a `ParticleEmitter`. Advances the emitter in
 * `onUpdate` and renders sprites in `draw`. Particles are stored in the node's
 * LOCAL coord space, `setOrigin(x, y)` positions the emission point in
 * node-local coords, so parenting the node under a moving object makes
 * particles follow that object, while parenting it to `scene.root` (identity
 * transform) lets you emit at world coords by setting origin to world coords.
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
