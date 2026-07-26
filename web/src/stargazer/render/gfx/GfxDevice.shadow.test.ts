import { describe, it, expect } from 'vitest'
import { MockGfxDevice } from './webgl2/mockGfxDevice'

// The shadow pass extends the device seam with depth-array/cube targets, a
// depth-only render path, comparison samplers, and a mat4-array uniform. jsdom
// has no WebGL2 context, so these assert the seam through the mock the renderer
// tests already use; real depth/compare behavior is a browser-only check.

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

  it('records the layers begun and the shadow-pass end', () => {
    const device = new MockGfxDevice()
    const arr = device.createShadowArray(1024, 4)
    device.beginShadowLayer(arr, 0)
    device.beginShadowLayer(arr, 2)
    device.endShadowPass()
    expect(device.shadowLayerBegins).toEqual([0, 2])
    expect(device.shadowPassEnds).toBe(1)
  })

  it('records six cube faces for a point light', () => {
    const device = new MockGfxDevice()
    const cube = device.createShadowCube(512)
    for (let f = 0; f < 6; f++) device.beginShadowCubeFace(cube, f)
    expect(device.shadowCubeFaceBegins).toEqual([0, 1, 2, 3, 4, 5])
  })

  it('captures a mat4 array and the shadow sampler unit', () => {
    const device = new MockGfxDevice()
    const p = device.createProgram({
      vertexSrc: '',
      fragmentSrc: '',
      attribs: {},
    })
    const mats = new Float32Array(32) // two mat4s
    mats[0] = 5
    device.setUniformMat4Array(p, 'u_shadowMat', mats)
    const arr = device.createShadowArray(256, 2)
    device.setUniformShadowArray(p, 'u_shadowArray', arr, 6)
    const captured = device.capturedUniforms.get(p)
    expect((captured?.get('u_shadowMat') as Float32Array)[0]).toBe(5)
    expect(captured?.get('u_shadowArray')).toBe(6)
  })
})
