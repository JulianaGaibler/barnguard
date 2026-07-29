import { afterEach, describe, expect, it } from 'vitest'
import { GpuGfx } from './GpuGfx'
import { MockGfxDevice } from './webgl2/mockGfxDevice'
import {
  registerPathTessellation,
  releasePathTessellation,
} from './PathTessellationRegistry'
import type { GeometryHandle } from './GeometryHandle'

function makeGpuGfx(): { gfx: GpuGfx; device: MockGfxDevice } {
  const canvas = document.createElement('canvas')
  canvas.width = 400
  canvas.height = 300
  const device = new MockGfxDevice()
  const gfx = new GpuGfx(canvas, device)
  return { gfx, device }
}

async function frame(
  gfx: GpuGfx,
  device: MockGfxDevice,
  draw: () => void,
): Promise<void> {
  await gfx.whenReady // pipelines warm asynchronously
  device.reset()
  gfx.beginFrame({
    clearColor: '#0d1a2c',
    transparent: false,
    pixelW: 400,
    pixelH: 300,
  })
  gfx.setBaseTransform(1, 0, 0, 1, 0, 0)
  gfx.setAlpha(1)
  draw()
  gfx.endFrame()
}

/** A tiny two-triangle quad tessellation, flagged retained. */
function makeRetainedHandle(): GeometryHandle {
  return {
    vertices: new Float32Array([0, 0, 10, 0, 10, 10, 0, 10]),
    indices: new Uint16Array([0, 1, 2, 0, 2, 3]),
  }
}

const paths: Path2D[] = []
afterEach(() => {
  for (const p of paths) releasePathTessellation(p)
  paths.length = 0
})

describe('GpuGfx retained fillPath2D', () => {
  it('uploads geometry once, then draws with drawElements each frame', async () => {
    const { gfx, device } = makeGpuGfx()
    const path = new Path2D()
    paths.push(path)
    registerPathTessellation(path, makeRetainedHandle(), undefined, undefined, {
      retained: true,
    })

    // Frame 1: first fill uploads the vbo + ibo, then draws indexed.
    await frame(gfx, device, () => gfx.fillPath2D(path, '#ff8040'))
    expect(device.indexBuffers.length).toBe(1)
    expect(device.indexUploads.length).toBe(1)
    const draws1 = device.draws.filter((d) => d.kind === 'elements')
    expect(draws1.length).toBe(1)
    expect(draws1[0].count).toBe(6) // 2 triangles × 3 indices

    // Frames 2 and 3: no re-upload, still one drawElements each (device.reset
    // clears the per-frame logs but not the created-buffer lists).
    await frame(gfx, device, () => gfx.fillPath2D(path, '#ff8040'))
    expect(device.indexUploads.length).toBe(0) // reset cleared the log; no new upload
    expect(device.draws.filter((d) => d.kind === 'elements').length).toBe(1)

    await frame(gfx, device, () => gfx.fillPath2D(path, '#ff8040'))
    expect(device.indexUploads.length).toBe(0)
    expect(device.draws.filter((d) => d.kind === 'elements').length).toBe(1)
  })

  it('interleaves a retained fill with streamed fills in painter order', async () => {
    const { gfx, device } = makeGpuGfx()
    const path = new Path2D()
    paths.push(path)
    registerPathTessellation(path, makeRetainedHandle(), undefined, undefined, {
      retained: true,
    })

    await frame(gfx, device, () => {
      gfx.fillRect(0, 0, 5, 5, '#f00') // streamed coloredTri
      gfx.fillPath2D(path, '#0f0') // retained
      gfx.fillRect(10, 10, 5, 5, '#00f') // streamed coloredTri
    })
    // Three runs, replayed in order: arrays, elements, arrays.
    expect(device.draws.map((d) => d.kind)).toEqual([
      'arrays',
      'elements',
      'arrays',
    ])
  })

  it('falls back to the streamed path when a small geometry is not retained', async () => {
    const { gfx, device } = makeGpuGfx()
    const path = new Path2D()
    paths.push(path)
    // No retained flag + small (under the auto-retain index threshold).
    registerPathTessellation(path, makeRetainedHandle())

    await frame(gfx, device, () => gfx.fillPath2D(path, '#ff8040'))
    expect(device.indexBuffers.length).toBe(0) // never went to the GPU index path
    expect(device.draws.map((d) => d.kind)).toEqual(['arrays'])
  })
})
