import { createEngineHost } from '../engine/EngineHost'
import type { DemoFn } from './types'

/**
 * M1 demo, verifies the engine's main loop, DPR handling, resize plumbing, and
 * context-loss recovery. Logs frame stats once per second.
 */
const runDemo: DemoFn = ({ canvas, signal, attach }) => {
  const host = createEngineHost({ canvas, clearColor: '#0d1a2c' })
  attach?.(host)

  const offFns: Array<() => void> = []

  let framesInWindow = 0
  let lastReportMs = performance.now()
  offFns.push(
    host.events.on('frame', ({ dt, frameNum }) => {
      framesInWindow++
      const nowMs = performance.now()
      if (nowMs - lastReportMs >= 1000) {
        const { cssSize, pixelSize, dpr } = host.engine.renderer
        console.info(
          `[demo-loop] frame=${frameNum} fps≈${framesInWindow} dt=${dt.toFixed(4)}s ` +
            `css=${cssSize.w}×${cssSize.h} device=${pixelSize.w}×${pixelSize.h} dpr=${dpr} ` +
            `fixedAlpha=${host.engine.ticker.fixedAlpha.toFixed(3)}`,
        )
        framesInWindow = 0
        lastReportMs = nowMs
      }
    }),
  )

  offFns.push(
    host.events.on('ready', ({ pixelSize }) => {
      console.info(
        `[demo-loop] ready, canvas ${pixelSize.w}×${pixelSize.h} device px`,
      )
    }),
  )

  offFns.push(
    host.events.on('resize', ({ css, pixel, dpr }) => {
      console.info(
        `[demo-loop] resize, css ${css.w}×${css.h}, device ${pixel.w}×${pixel.h}, dpr=${dpr}`,
      )
    }),
  )

  offFns.push(
    host.events.on('contextlost', ({ restorable }) => {
      console.warn(`[demo-loop] contextlost, restorable=${restorable}`)
    }),
  )

  offFns.push(
    host.events.on('contextrestored', () => {
      console.info('[demo-loop] contextrestored')
    }),
  )

  host.start()

  const stop = (): void => {
    for (const off of offFns) off()
    offFns.length = 0
    host.destroy()
  }

  signal.addEventListener('abort', stop, { once: true })
  return stop
}

export default runDemo
