import { describe, expect, it } from 'vitest'
import {
  aoBytes,
  headroom,
  impactOf,
  targetBytes,
  totalTargetBytes,
  type ImpactContext,
} from './qualityImpact'

const CTX: ImpactContext = {
  pixelW: 2560,
  pixelH: 1440,
  scale: 1,
  samples: 4,
  backend: 'webgl2',
  has3D: true,
  aoResolution: 'full',
}

describe('render target memory', () => {
  it('counts colour and depth per sample, plus a resolve target when multisampled', () => {
    const px = 1000
    expect(targetBytes(px, 1)).toBe(px * 8)
    expect(targetBytes(px, 4)).toBe(px * 8 * 4 + px * 4)
  })

  it('takes a quarter of the memory for half-resolution AO', () => {
    expect(aoBytes(1000, 'half')).toBe(aoBytes(1000, 'full') / 4)
  })
})

describe('impactOf', () => {
  it('scales pixel work with the square of the render scale, from the native size', () => {
    const scaled: ImpactContext = {
      ...CTX,
      scale: 0.5,
      pixelW: 1280,
      pixelH: 720,
    }
    const full = impactOf('scale', 1, scaled)
    const three = impactOf('scale', 0.75, scaled)
    expect(full.pixelShare).toBe(1)
    expect(three.pixelShare).toBeCloseTo(0.5625)
    // 0.75 of 2560 by 1440, measured from the native size.
    expect(three.memory).toBe(targetBytes(2560 * 1440 * 0.5625, 4))
  })

  it('says a 3D setting does nothing in a 2D scene', () => {
    const ctx = { ...CTX, has3D: false }
    expect(impactOf('shadows', 9, ctx).inert).toMatch(/no 3D/)
    expect(impactOf('aoPreset', 'high', ctx).inert).toMatch(/no 3D/)
    expect(impactOf('shadows', 9, CTX).inert).toBeNull()
  })

  it('says WebGPU runs 2× MSAA as 1×', () => {
    const gpu = impactOf('msaa', 2, { ...CTX, backend: 'webgpu' })
    expect(gpu.inert).toMatch(/1×/)
    expect(gpu.memory).toBe(targetBytes(2560 * 1440, 1))
    expect(impactOf('msaa', 2, CTX).inert).toBeNull()
  })

  it('names the reference hardware wherever it quotes a measured saving', () => {
    expect(impactOf('scale', 0.75, CTX).reference).toMatch(/Iris Xe/)
    expect(impactOf('aoResolution', 'half', CTX).reference).toMatch(/39%/)
    expect(impactOf('scale', 0.85, CTX).reference).toBeNull()
  })

  it('totals the targets the values would hold', () => {
    const base = totalTargetBytes(
      { msaa: 4, scale: 1, shadows: 9, aoPreset: 'off', aoResolution: 'full' },
      CTX,
    )
    const withAo = totalTargetBytes(
      { msaa: 4, scale: 1, shadows: 9, aoPreset: 'high', aoResolution: 'full' },
      CTX,
    )
    expect(withAo - base).toBe(aoBytes(2560 * 1440, 'full'))
  })
})

describe('headroom', () => {
  const ok = {
    interval50: 0.0167,
    work50: 0.003,
    work95: 0.005,
    gpuMs: null,
    maxFps: 0,
  }

  it('reports room to spare when frames keep up and work is small', () => {
    const h = headroom(ok)
    expect(h.behind).toBe(false)
    expect(h.limiter).toBe('none')
    expect(h.advice).toMatch(/to spare/)
  })

  it('blames the GPU when frames are slow and CPU work is a small part of them', () => {
    const h = headroom({
      ...ok,
      interval50: 0.05,
      work50: 0.004,
      work95: 0.006,
    })
    expect(h.behind).toBe(true)
    expect(h.limiter).toBe('gpu')
  })

  it('blames the CPU when frames are slow and CPU work fills them', () => {
    const h = headroom({ ...ok, interval50: 0.05, work50: 0.04, work95: 0.045 })
    expect(h.limiter).toBe('cpu')
    expect(h.advice).toMatch(/will not help/)
  })

  it('does not count a frame cap as slow', () => {
    expect(headroom({ ...ok, interval50: 0.033, maxFps: 30 }).behind).toBe(
      false,
    )
  })

  it('uses the measured GPU time when there is one', () => {
    const h = headroom({ ...ok, gpuMs: 14 })
    expect(h.gpuShare).toBeCloseTo(14 / (1000 / 60))
    expect(h.limiter).toBe('gpu')
  })

  it('says it is waiting before there are frames', () => {
    expect(headroom({ ...ok, interval50: 0 }).limiter).toBe('unknown')
  })
})
