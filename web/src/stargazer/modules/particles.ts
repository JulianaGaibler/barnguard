/**
 * A pooled particle system. {@link ParticleEmitter} allocates a
 * {@link ParticlePool} up front and emits/integrates particles allocation-free;
 * {@link ParticleEmitterConfig} sets rate, kinematics, and the size/alpha
 * curves. In a scene, wrap it in a `ParticleEmitterNode`.
 * {@link getParticleSprite} caches the rasterized sprite per color and style.
 *
 * @module particles
 * @category Particles
 */
export { ParticleEmitter } from '../particles/ParticleEmitter'
export type { ParticleEmitterConfig } from '../particles/ParticleEmitter'
export { ParticlePool } from '../particles/ParticlePool'
export type { ParticleField } from '../particles/ParticlePool'
export { getParticleSprite, clearParticleSpriteCache } from '../particles/draw'
export type { ParticleSpriteStyle } from '../particles/draw'
