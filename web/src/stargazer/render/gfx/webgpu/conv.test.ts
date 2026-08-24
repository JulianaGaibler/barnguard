import { describe, expect, it } from 'vitest'
import { colorTargetToGPU, depthStencilToGPU } from './conv'
import type { PipelineDesc } from '../GfxDevice'

describe('colorTargetToGPU', () => {
  it('writes every channel by default', () => {
    const t = colorTargetToGPU({ format: 'linear', blend: 'source-over' })
    expect(t.writeMask).toBe(0xf)
    expect(t.format).toBe('rgba8unorm')
  })

  it('masks color off when the state turns writes off', () => {
    // The stencil reset pass draws the same geometry a second time to zero its
    // bits. A nonzero mask would composite the stroke twice.
    const t = colorTargetToGPU({
      format: 'linear',
      blend: 'source-over',
      write: false,
    })
    expect(t.writeMask).toBe(0)
  })

  it('treats an explicit true the same as the default', () => {
    const t = colorTargetToGPU({
      format: 'srgb',
      blend: 'lighter',
      write: true,
    })
    expect(t.writeMask).toBe(0xf)
    expect(t.format).toBe('rgba8unorm-srgb')
  })
})

describe('depthStencilToGPU', () => {
  const base: PipelineDesc = {
    shader: {} as PipelineDesc['shader'],
    vertexLayout: [],
    bindGroupLayouts: [],
    color: { format: 'linear', blend: 'source-over' },
    depth: null,
    cull: 'none',
    frontFace: 'ccw',
    primitive: 'triangle-list',
    samples: 1,
  }

  it('omits the state entirely with no attachment', () => {
    expect(depthStencilToGPU(base)).toBeUndefined()
  })

  it('derives a depth-only format from a depth state', () => {
    const s = depthStencilToGPU({ ...base, depth: { test: true, write: true } })
    expect(s?.format).toBe('depth24plus')
    expect(s?.depthWriteEnabled).toBe(true)
    expect(s?.depthCompare).toBe('less-equal')
    // stencil8 has no stencil aspect here, so no stencil state may appear.
    expect(s?.stencilFront).toBeUndefined()
  })

  it('leaves depth out of a stencil-only format', () => {
    const s = depthStencilToGPU({
      ...base,
      stencil: { front: { compare: 'equal', passOp: 'increment-clamp' } },
    })
    expect(s?.format).toBe('stencil8')
    expect(s?.stencilFront?.compare).toBe('equal')
    expect(s?.depthBias).toBeUndefined()
  })

  it('fills in an inert depth aspect for a 2D pipeline on a combined target', () => {
    const s = depthStencilToGPU({
      ...base,
      depthStencil: 'depth-stencil',
      stencil: { front: { compare: 'equal', passOp: 'increment-clamp' } },
    })
    expect(s?.format).toBe('depth24plus-stencil8')
    expect(s?.depthWriteEnabled).toBe(false)
    expect(s?.depthCompare).toBe('always')
    // A bias on an inert aspect is rejected on a line-list topology.
    expect(s?.depthBias).toBeUndefined()
    expect(s?.stencilFront?.passOp).toBe('increment-clamp')
  })

  it('fills in an inert stencil aspect for a 3D pipeline on a combined target', () => {
    const s = depthStencilToGPU({
      ...base,
      depthStencil: 'depth-stencil',
      depth: { test: true, write: true },
    })
    expect(s?.format).toBe('depth24plus-stencil8')
    expect(s?.depthWriteEnabled).toBe(true)
    // A zero write mask with all-keep ops cannot touch the bits the 2D path
    // owns in the same pass.
    expect(s?.stencilWriteMask).toBe(0)
    expect(s?.stencilFront?.compare).toBe('always')
    expect(s?.stencilFront?.passOp).toBe('keep')
    expect(s?.stencilBack?.passOp).toBe('keep')
  })

  it('turns a disabled depth test into an always compare', () => {
    const s = depthStencilToGPU({
      ...base,
      depth: { test: false, write: false },
    })
    expect(s?.depthCompare).toBe('always')
    expect(s?.depthWriteEnabled).toBe(false)
  })
})
