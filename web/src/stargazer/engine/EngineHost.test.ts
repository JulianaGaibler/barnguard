import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createEngineHost } from './EngineHost'
import { MockGfxDevice } from '../render/gfx/webgl2/mockGfxDevice'

describe('EngineHost retry ladder', () => {
  let canvas: HTMLCanvasElement

  beforeEach(() => {
    vi.useFakeTimers()
    canvas = document.createElement('canvas')
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
    const host = createEngineHost({
      canvas,
      onReload,
      gpuDevice: new MockGfxDevice(),
    })
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
    const host = createEngineHost({
      canvas,
      onReload,
      gpuDevice: new MockGfxDevice(),
    })
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
    const host = createEngineHost({
      canvas,
      onReload,
      gpuDevice: new MockGfxDevice(),
    })
    // Synthesize a non-restorable loss.
    const e = new Event('webglcontextlost', { cancelable: true })
    ;(e as unknown as { canBeRestored: boolean }).canBeRestored = false
    canvas.dispatchEvent(e)
    expect(onReload).toHaveBeenCalledTimes(1)
    host.destroy()
  })
})

describe('EngineHost WebGPU loss', () => {
  it('a lost WebGPU device fires backendlost + onBackendLost, not the ladder', () => {
    const canvas = document.createElement('canvas')
    const device = new MockGfxDevice('webgpu')
    const onBackendLost = vi.fn()
    const onReload = vi.fn()
    const host = createEngineHost({
      canvas,
      onBackendLost,
      onReload,
      gpuDevice: device,
    })
    const events: Array<{ backend: string }> = []
    host.events.on('backendlost', (e) => events.push(e))

    device.simulateContextLost()

    expect(onBackendLost).toHaveBeenCalledTimes(1)
    expect(onReload).not.toHaveBeenCalled()
    expect(events).toEqual([{ backend: 'webgpu' }])
    host.destroy()
  })

  it('without an override a lost WebGPU device reloads', () => {
    const canvas = document.createElement('canvas')
    const device = new MockGfxDevice('webgpu')
    const onReload = vi.fn()
    const host = createEngineHost({ canvas, onReload, gpuDevice: device })
    device.simulateContextLost()
    expect(onReload).toHaveBeenCalledTimes(1)
    host.destroy()
  })
})
