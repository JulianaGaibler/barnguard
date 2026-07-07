import { createEngineHost } from '../engine/EngineHost'
import { ShapeNode } from '../nodes/ShapeNode'
import { Timeline } from '../anim/Timeline'
import { ignoreAbort } from '../anim/abortSignal'
import { outBack, outCubic, inOutQuad, inQuad } from '../math/easings'
import type { DemoFn } from './types'

/**
 * M6 demo, a single hero shape running an infinite Timeline of tweens.
 *
 * - Grow (scale 0→1, outBack) → shift right → shift left → return → fade out →
 *   fade in → shrink → repeat.
 * - Press `D` to destroy the hero mid-tween. All outstanding tweens reject with
 *   AbortError, `ignoreAbort` swallows them, no unhandled promise rejection
 *   warnings.
 * - Press `O` to start an overlapping tween on the hero's `x`, the dev-only
 *   overlap warning fires in the console (last-writer-wins).
 * - Press `L` to run 2,000 tight `node.wait` cycles as a listener-leak stress
 *   test; check the browser's memory tools after, heap stays flat because the
 *   abort-listener contract removes on natural completion.
 */
const runDemo: DemoFn = async ({ canvas, signal, attach }) => {
  const host = createEngineHost({
    canvas,
    clearColor: '#0d1a2c',
    initialViewport: { x: 0, y: 0, width: 1920, height: 1080 },
  })
  attach?.(host)

  let hero: ShapeNode | null = null
  await host.loadScene((scene) => {
    hero = new ShapeNode({
      id: 'hero',
      geometry: { kind: 'circle', radius: 80 },
      fill: '#ffd34d',
      stroke: '#fdf6e3',
      lineWidth: 3,
    })
    hero.transform.x = 960
    hero.transform.y = 540
    hero.transform.scaleX = 0
    hero.transform.scaleY = 0
    scene.root.add(hero)
  })
  if (!hero) throw new Error('demo-anim: hero not created')
  const heroRef: ShapeNode = hero
  host.start()

  // Kick off the infinite animation loop. Any AbortError from destroying the
  // node is silently swallowed by `ignoreAbort`.
  const loop = async (): Promise<void> => {
    try {
      while (!heroRef.isDestroyed) {
        const t = new Timeline()
          .add(() =>
            heroRef.tween(
              { scaleX: 1, scaleY: 1 },
              { duration: 0.35, easing: outBack },
            ),
          )
          .add(() =>
            heroRef.tween({ x: 1360 }, { duration: 0.5, easing: inOutQuad }),
          )
          .add(() =>
            heroRef.tween({ x: 560 }, { duration: 0.5, easing: inOutQuad }),
          )
          .add(() =>
            heroRef.tween({ x: 960 }, { duration: 0.35, easing: outCubic }),
          )
          .add(() =>
            heroRef.tween(
              { alpha: 0.15 },
              { duration: 0.4, easing: inOutQuad },
            ),
          )
          .add(() => heroRef.wait(0.25))
          .add(() =>
            heroRef.tween({ alpha: 1 }, { duration: 0.4, easing: inOutQuad }),
          )
          .add(() =>
            heroRef.tween(
              { scaleX: 0, scaleY: 0 },
              { duration: 0.35, easing: inQuad },
            ),
          )
          .add(() => heroRef.wait(0.5))
        await t.run(heroRef.abortSignal)
      }
    } catch (err) {
      ignoreAbort(err)
    }
  }
  void loop()

  const onKey = (e: KeyboardEvent): void => {
    if (e.key === 'd' || e.key === 'D') {
      if (heroRef.isDestroyed) return
      console.info('[demo-anim] destroying hero mid-tween')
      heroRef.destroy()
      return
    }
    if (e.key === 'o' || e.key === 'O') {
      // Kick a competing tween on the same key, expect a console warning.
      console.info('[demo-anim] starting overlapping tween on hero.x')
      heroRef
        .tween({ x: 200 }, { duration: 0.6, easing: outCubic })
        .catch(ignoreAbort)
      return
    }
    if (e.key === 'l' || e.key === 'L') {
      const CYCLES = 2000
      console.info(`[demo-anim] listener-leak stress: ${CYCLES} rapid waits`)
      const controller = new AbortController()
      const started = performance.now()
      let done = 0
      const loop = async (): Promise<void> => {
        for (let i = 0; i < CYCLES; i++) {
          if (controller.signal.aborted) return
          await host.engine.animation.wait(0.001, controller.signal)
          done++
        }
      }
      loop()
        .then(() => {
          const ms = performance.now() - started
          console.info(
            `[demo-anim] stress complete: ${done}/${CYCLES} in ${ms.toFixed(0)}ms`,
          )
        })
        .catch(ignoreAbort)
    }
  }
  window.addEventListener('keydown', onKey)

  const stop = (): void => {
    window.removeEventListener('keydown', onKey)
    host.destroy()
  }
  signal.addEventListener('abort', stop, { once: true })
  return stop
}

export default runDemo
