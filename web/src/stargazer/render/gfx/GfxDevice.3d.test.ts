import { describe, it, expect } from 'vitest'
import { MockGfxDevice } from './webgl2/mockGfxDevice'

// The 3D pass extends the device seam with a mat4 uniform, depth/cull state, a
// 32-bit index option, and an sRGB color-attachment option, all additive to the
// 2D pipeline. These assert the seam via the mock the renderer tests already
// use (jsdom has no WebGL2 context).

describe('GfxDevice color space', () => {
  it('defaults a render target to linear', () => {
    const device = new MockGfxDevice()
    const rt = device.createRenderTarget({ width: 32, height: 32 })
    expect((rt as unknown as { colorSpace: string }).colorSpace).toBe('linear')
  })

  it('allocates an sRGB target when requested', () => {
    const device = new MockGfxDevice()
    const rt = device.createRenderTarget({
      width: 32,
      height: 32,
      colorSpace: 'srgb',
    })
    expect((rt as unknown as { colorSpace: string }).colorSpace).toBe('srgb')
  })
})

describe('GfxDevice index type', () => {
  it('defaults an index buffer to u16', () => {
    const device = new MockGfxDevice()
    device.createIndexBuffer(128)
    expect(device.indexBufferTypes.at(-1)).toBe('u16')
  })

  it('records a u32 index buffer for large meshes', () => {
    const device = new MockGfxDevice()
    device.createIndexBuffer(1024, 'u32')
    expect(device.indexBufferTypes.at(-1)).toBe('u32')
  })
})

describe('GfxDevice 3D render state', () => {
  it('sets depth, cull, and blend independently', () => {
    const device = new MockGfxDevice()
    device.setDepthTest(true)
    device.setDepthWrite(false)
    device.setCullFace('back')
    expect(device.depthTest).toBe(true)
    expect(device.depthWrite).toBe(false)
    expect(device.cull).toBe('back')
  })

  it('resetToBaseline restores the 2D-pass baseline', () => {
    const device = new MockGfxDevice()
    device.setDepthTest(true)
    device.setDepthWrite(false)
    device.setCullFace('front')
    device.setBlend('lighter')

    device.resetToBaseline()

    expect(device.depthTest).toBe(false)
    expect(device.depthWrite).toBe(true)
    expect(device.cull).toBe('none')
    expect(device.resetToBaselineCount).toBe(1)
  })
})

describe('GfxDevice mat4 uniform', () => {
  it('captures a mat4 view-projection', () => {
    const device = new MockGfxDevice()
    const program = device.createProgram({
      vertexSrc: '',
      fragmentSrc: '',
      attribs: {},
    })
    const m = new Float32Array(16)
    m[0] = 2
    m[15] = 1
    device.setUniformMat4(program, 'u_viewProj', m)
    const captured = device.capturedUniforms.get(program)?.get('u_viewProj')
    expect(captured).toBeInstanceOf(Float32Array)
    expect((captured as Float32Array)[0]).toBe(2)
  })
})
