import { describe, it, expect } from 'vitest'
import { MockGfxDevice } from './webgl2/mockGfxDevice'
import type { DepthTarget } from './GfxDevice'

// The shadow pass uses depth-array/cube targets, depth-only render passes, and
// comparison-sampler bind-group entries. happy-dom has no WebGL2 context, so
// these assert the seam through the mock; real depth/compare behavior is a
// browser-only check.

describe('GfxDevice shadow targets', () => {
  it('allocates a depth-array shadow map with the requested size and layers', () => {
    const device = new MockGfxDevice()
    const arr = device.createShadowArray(2048, 8)
    expect(arr.size).toBe(2048)
    expect(arr.layers).toBe(8)
    expect(device.shadowArrays).toHaveLength(1)
  })

  it('allocates a depth cubemap shadow map', () => {
    const device = new MockGfxDevice()
    const cube = device.createShadowCube(1024)
    expect(cube.size).toBe(1024)
    expect(device.shadowCubes).toHaveLength(1)
  })

  it('records a depth-only render pass per shadow-array layer', () => {
    const device = new MockGfxDevice()
    const arr = device.createShadowArray(1024, 4)
    for (const layer of [0, 2]) {
      device.beginRenderPass({
        depth: { target: { shadowArray: arr, layer }, loadOp: 'clear' },
      })
      device.endRenderPass()
    }
    const layers = device.passes.map((p) => {
      const t = p.desc.depth?.target as DepthTarget
      return 'shadowArray' in t ? t.layer : -1
    })
    expect(layers).toEqual([0, 2])
    // Depth-only: no color attachment.
    expect(device.passes.every((p) => p.desc.color === undefined)).toBe(true)
  })

  it('records six cube-face render passes for a point light', () => {
    const device = new MockGfxDevice()
    const cube = device.createShadowCube(512)
    for (let f = 0; f < 6; f++) {
      device.beginRenderPass({
        depth: { target: { shadowCube: cube, face: f }, loadOp: 'clear' },
      })
      device.endRenderPass()
    }
    const faces = device.passes.map((p) => {
      const t = p.desc.depth?.target as DepthTarget
      return 'shadowCube' in t ? t.face : -1
    })
    expect(faces).toEqual([0, 1, 2, 3, 4, 5])
  })

  it('binds a shadow array through a comparison-sampler bind group', () => {
    const device = new MockGfxDevice()
    const arr = device.createShadowArray(256, 2)
    const layout = device.createBindGroupLayout([
      { binding: 8, type: 'texture-2d-array-shadow' },
    ])
    device.createBindGroup(layout, [
      { binding: 8, resource: { shadowArray: arr } },
    ])
    expect(device.bindGroups).toHaveLength(1)
  })
})
