import { createEngineHost } from '../engine/EngineHost'
import { ParticleEmitterNode } from '../nodes/ParticleEmitterNode'
import type { DemoFn } from './types'

/**
 * M7 demo, two live emitters exercise the pool + kinematics + sprite path.
 *
 * - **Trail**: continuous stream anchored to the pointer world position. Moderate
 *   damping + alpha decay so the tail shrinks behind the mouse.
 * - **Burst**: on pointer-down, 500 particles from the tap point spray radially
 *   with strong damping, expand, slow, fade.
 * - `?demo=particles&debug=hud` reports total alive particles in the "Scene"
 *   section, the perf gate is two 500-particle emitters + the trail staying
 *   under 16.6 ms p95 at 4K aspect.
 */
const runDemo: DemoFn = async ({ canvas, signal, attach }) => {
  const host = createEngineHost({
    canvas,
    clearColor: '#0d1a2c',
    initialViewport: { x: 0, y: 0, width: 1920, height: 1080 },
  })
  attach?.(host)

  let trail: ParticleEmitterNode | null = null
  let burst: ParticleEmitterNode | null = null
  await host.loadScene((scene) => {
    trail = new ParticleEmitterNode({
      id: 'trail',
      config: {
        capacity: 500,
        ratePerSec: 90,
        lifetimeSec: [0.5, 1.1],
        speedWorld: [10, 40],
        spreadRad: Math.PI * 0.35,
        emitDirectionRad: undefined, // radial
        sizeWorld: [12, 24],
        palette: ['#ffd34d', '#ffb347', '#ff8f6b'],
        blend: 'lighter',
        dampingPerSec: 1.6,
        scaleOverLife: [1, 0.3],
        alphaOverLife: [1, 0],
      },
    })
    scene.root.add(trail)

    // Burst uses `spriteStyle: 'disc'` + `blend: 'source-over'`, hard-edged,
    // non-bloomed particles. Overlapping ones just paint over each other by
    // alpha (no additive brightening). Compare vs the bloomy trail.
    burst = new ParticleEmitterNode({
      id: 'burst',
      config: {
        capacity: 500,
        ratePerSec: 0,
        lifetimeSec: [0.6, 1.2],
        speedWorld: [220, 480],
        spreadRad: Math.PI, // full 360 via wide cone
        emitDirectionRad: undefined,
        sizeWorld: [10, 22],
        palette: ['#41a8ff', '#89d5ff', '#c084fc'],
        spriteStyle: 'disc',
        blend: 'source-over',
        dampingPerSec: 2.6,
        scaleOverLife: [1, 0.15],
        alphaOverLife: [1, 0],
      },
    })
    scene.root.add(burst)
  })
  if (!trail || !burst) throw new Error('demo-particles: emitters not created')
  const trailRef: ParticleEmitterNode = trail
  const burstRef: ParticleEmitterNode = burst
  host.start()

  // Track pointer position → trail origin.
  const setOriginFromEvent = (e: PointerEvent): void => {
    const rect = canvas.getBoundingClientRect()
    const cssX = e.clientX - rect.left
    const cssY = e.clientY - rect.top
    const w = host.engine.activeCamera.screenToWorld(cssX, cssY)
    trailRef.emitter.setOrigin(w.x, w.y)
  }
  const onMove = (e: PointerEvent): void => setOriginFromEvent(e)
  const onDown = (e: PointerEvent): void => {
    setOriginFromEvent(e)
    const rect = canvas.getBoundingClientRect()
    const w = host.engine.activeCamera.screenToWorld(
      e.clientX - rect.left,
      e.clientY - rect.top,
    )
    burstRef.emitter.burst(500, w.x, w.y)
  }
  const onLeave = (): void => {
    // Send origin off-screen so the trail stops trailing into the last known
    // position when the pointer leaves.
    trailRef.emitter.setOrigin(-9999, -9999)
  }
  canvas.addEventListener('pointermove', onMove)
  canvas.addEventListener('pointerdown', onDown)
  canvas.addEventListener('pointerleave', onLeave)

  // Seed the origin at world center so the trail starts alive before the
  // pointer moves.
  trailRef.emitter.setOrigin(960, 540)

  const stop = (): void => {
    canvas.removeEventListener('pointermove', onMove)
    canvas.removeEventListener('pointerdown', onDown)
    canvas.removeEventListener('pointerleave', onLeave)
    host.destroy()
  }
  signal.addEventListener('abort', stop, { once: true })
  return stop
}

export default runDemo
