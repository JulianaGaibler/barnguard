import { describe, it, expect } from 'vitest'
import { MockGfxDevice } from './webgl2/mockGfxDevice'
import type { PipelineDesc } from './GfxDevice'

// The 3D pass extends the device seam with depth/cull/winding baked into
// pipelines, uniform buffers for per-frame/per-object data, a 32-bit index
// option, and an sRGB color-attachment option. These assert the seam via the
// mock the renderer tests use (happy-dom has no WebGL2 context).

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

describe('GfxDevice pipeline state', () => {
  it('bakes depth, cull, and blend into a pipeline', async () => {
    const device = new MockGfxDevice()
    const shader = device.createShaderModule({
      glsl: { vertex: '', fragment: '' },
      reflection: { attributes: [], uniformBlocks: [], samplers: [] },
    })
    const layout = device.createBindGroupLayout([])
    const pipeline = await device.createPipeline({
      shader,
      vertexLayout: [],
      bindGroupLayouts: [layout],
      color: { format: 'linear', blend: 'lighter' },
      depth: { test: true, write: false },
      cull: 'back',
      frontFace: 'ccw',
      primitive: 'triangle-list',
      samples: 1,
    })
    const desc = (pipeline as unknown as { desc: PipelineDesc }).desc
    expect(desc.depth).toEqual({ test: true, write: false })
    expect(desc.cull).toBe('back')
    expect(desc.color?.blend).toBe('lighter')
  })

  it('allows a depth-only pipeline (no color target)', async () => {
    const device = new MockGfxDevice()
    const shader = device.createShaderModule({
      glsl: { vertex: '', fragment: '' },
      reflection: { attributes: [], uniformBlocks: [], samplers: [] },
    })
    const pipeline = await device.createPipeline({
      shader,
      vertexLayout: [],
      bindGroupLayouts: [],
      color: null,
      depth: { test: true, write: true },
      cull: 'none',
      frontFace: 'ccw',
      primitive: 'triangle-list',
      samples: 1,
    })
    expect(
      (pipeline as unknown as { desc: PipelineDesc }).desc.color,
    ).toBeNull()
  })
})

describe('GfxDevice uniform buffers', () => {
  it('records a uniform-buffer upload with its data', () => {
    const device = new MockGfxDevice()
    const buf = device.createUniformBuffer(64)
    const m = new Float32Array(16)
    m[0] = 2
    m[15] = 1
    device.updateUniformBuffer(buf, m)
    const up = device.uniformUploads.at(-1)
    expect(up?.buffer).toBe(buf)
    const floats = new Float32Array(
      up!.data.buffer,
      up!.data.byteOffset,
      up!.data.byteLength / 4,
    )
    expect(floats[0]).toBe(2)
  })

  it('honors a byte offset for a dynamic-ring slice', () => {
    const device = new MockGfxDevice()
    const buf = device.createUniformBuffer(512)
    device.updateUniformBuffer(buf, new Float32Array([7]), 256)
    expect(device.uniformUploads.at(-1)?.byteOffset).toBe(256)
  })
})
