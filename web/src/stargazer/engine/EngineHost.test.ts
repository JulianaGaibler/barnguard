import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createEngineHost } from './EngineHost'

/**
 * Fake 2D context, enough surface for Canvas2DGfx construction + `Renderer`
 * sizing without exercising any actual rasterization. happy- dom's canvas
 * returns `null` from `getContext('2d')` by default, so without this shim `new
 * Engine(...)` throws inside Canvas2DGfx.
 */
function makeFakeCtx(): CanvasRenderingContext2D {
  const noop = (): void => {}
  return {
    canvas: null as unknown as HTMLCanvasElement,
    fillStyle: '',
    strokeStyle: '',
    globalAlpha: 1,
    lineWidth: 1,
    setTransform: noop,
    clearRect: noop,
    fillRect: noop,
    save: noop,
    restore: noop,
    translate: noop,
    scale: noop,
    rotate: noop,
    beginPath: noop,
    closePath: noop,
    moveTo: noop,
    lineTo: noop,
    quadraticCurveTo: noop,
    bezierCurveTo: noop,
    arc: noop,
    fill: noop,
    stroke: noop,
    setLineDash: noop,
    drawImage: noop,
    getContextAttributes: () => ({ alpha: true }),
    createRadialGradient: () => ({ addColorStop: noop }),
    createLinearGradient: () => ({ addColorStop: noop }),
  } as unknown as CanvasRenderingContext2D
}

describe('EngineHost retry ladder', () => {
  let canvas: HTMLCanvasElement

  beforeEach(() => {
    vi.useFakeTimers()
    canvas = document.createElement('canvas')
    // Provide a fake 2D context so Canvas2DGfx (default backend) can
    // construct without needing a real 2D rasterizer.
    const fakeCtx = makeFakeCtx()
    canvas.getContext = ((kind: string) =>
      kind === '2d' ? fakeCtx : null) as HTMLCanvasElement['getContext']
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  function dispatchLoss(): void {
    const e = new Event('webglcontextlost', { cancelable: true })
    canvas.dispatchEvent(e)
  }

  it('T9: 3 losses within 60 s trigger onReload exactly once', () => {
    const onReload = vi.fn()
    const host = createEngineHost({ canvas, onReload, renderer: 'canvas2d' })
    dispatchLoss()
    vi.advanceTimersByTime(10_000)
    dispatchLoss()
    expect(onReload).not.toHaveBeenCalled()
    vi.advanceTimersByTime(10_000)
    dispatchLoss()
    expect(onReload).toHaveBeenCalledTimes(1)
    host.destroy()
  })

  it('losses spread beyond 60 s do NOT trigger onReload', () => {
    const onReload = vi.fn()
    const host = createEngineHost({ canvas, onReload, renderer: 'canvas2d' })
    dispatchLoss()
    vi.advanceTimersByTime(30_000)
    dispatchLoss()
    vi.advanceTimersByTime(35_000) // total 65s since first
    // The first-loss timestamp is evicted by the 60s window.
    dispatchLoss()
    expect(onReload).not.toHaveBeenCalled()
    host.destroy()
  })

  it('unrestorable loss triggers onReload immediately, ignoring the ladder', () => {
    const onReload = vi.fn()
    const host = createEngineHost({ canvas, onReload, renderer: 'canvas2d' })
    // Synthesize a non-restorable loss.
    const e = new Event('webglcontextlost', { cancelable: true })
    ;(e as unknown as { canBeRestored: boolean }).canBeRestored = false
    canvas.dispatchEvent(e)
    expect(onReload).toHaveBeenCalledTimes(1)
    host.destroy()
  })
})
