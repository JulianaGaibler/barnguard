import { describe, expect, it } from 'vitest'
import { createGpuFrameTimer } from './GpuFrameTimer'
import type { Engine } from '../engine/Engine'

function webgpuEngine(timestamps: boolean) {
  let listener: ((ms: number) => void) | null = null
  const engine = {
    primaryStage: {
      backend: 'webgpu',
      device: {
        onGpuFrameTime: (l: (ms: number) => void) => {
          if (!timestamps) return null
          listener = l
          return () => {
            listener = null
          }
        },
      },
    },
  } as unknown as Engine
  return { engine, emit: (ms: number) => listener?.(ms), live: () => listener }
}

describe('createGpuFrameTimer on WebGPU', () => {
  it('records timestamp frame times while recording', () => {
    const { engine, emit, live } = webgpuEngine(true)
    const timer = createGpuFrameTimer(engine, document.createElement('canvas'))
    expect(timer.kind).toBe('elapsed')
    emit(1)
    timer.recording = true
    emit(2.5)
    expect(timer.samples).toEqual([2.5])
    timer.dispose()
    expect(live()).toBeNull()
  })

  it('reports no timer where the device has no timestamps', () => {
    const { engine } = webgpuEngine(false)
    const timer = createGpuFrameTimer(engine, document.createElement('canvas'))
    expect(timer.kind).toBe('none')
  })
})
