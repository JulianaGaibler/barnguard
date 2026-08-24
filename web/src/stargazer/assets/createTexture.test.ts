import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createTexture, textureFromImageBitmap } from './createTexture'

// happy-dom has no real canvas, so the decode and encode paths are stubbed. The
// contract worth pinning is the descriptor the renderer reads and the fact that
// construction resolves on the bitmap rather than waiting on the re-encode.

class FakeImageBitmap {
  readonly width = 4
  readonly height = 4
  close(): void {}
}

function fakeCanvas(toBlob?: HTMLCanvasElement['toBlob']): HTMLCanvasElement {
  return { toBlob: toBlob ?? (() => {}) } as unknown as HTMLCanvasElement
}

beforeEach(() => {
  vi.stubGlobal('ImageBitmap', FakeImageBitmap)
  vi.stubGlobal(
    'createImageBitmap',
    vi.fn(async () => new FakeImageBitmap()),
  )
})

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('createTexture', () => {
  it('defaults to clamped, mipmapped sRGB color', async () => {
    const tex = await createTexture(fakeCanvas())
    expect(tex.srgb).toBe(true)
    expect(tex.sampler).toEqual({ wrap: 'clamp', mipmap: true })
  })

  it('carries the sampling and color space it was given', async () => {
    const tex = await createTexture(fakeCanvas(), {
      srgb: false,
      wrap: 'repeat',
      mipmap: false,
    })
    expect(tex.srgb).toBe(false)
    expect(tex.sampler).toEqual({ wrap: 'repeat', mipmap: false })
  })

  it('resolves with a bitmap ready to upload', async () => {
    const tex = await createTexture(fakeCanvas())
    expect(tex.image.bitmap).toBeInstanceOf(FakeImageBitmap)
    expect(tex.image.mimeType).toBe('image/png')
  })

  it('decodes without premultiplying, which the renderer does itself', async () => {
    await createTexture(fakeCanvas())
    expect(globalThis.createImageBitmap).toHaveBeenCalledWith(
      expect.anything(),
      { premultiplyAlpha: 'none', colorSpaceConversion: 'none' },
    )
  })

  it('retains source bytes so the texture survives a context loss', async () => {
    const png = new Uint8Array([1, 2, 3, 4])
    const canvas = fakeCanvas((cb) => {
      cb({ arrayBuffer: async () => png.buffer } as Blob)
    })
    const tex = await createTexture(canvas)
    // The encode is deliberately off the critical path, so it lands later.
    expect(tex.image.bytes).toBeNull()
    await vi.waitFor(() => expect(tex.image.bytes).not.toBeNull())
    expect(tex.image.bytes).toEqual(png)
  })

  it('still builds a usable texture when the re-encode fails', async () => {
    const canvas = fakeCanvas(() => {
      throw new Error('no encoder')
    })
    const tex = await createTexture(canvas)
    expect(tex.image.bitmap).toBeInstanceOf(FakeImageBitmap)
  })

  it('passes an existing bitmap straight through', async () => {
    const bitmap = new FakeImageBitmap() as unknown as ImageBitmap
    const tex = await createTexture(bitmap)
    expect(tex.image.bitmap).toBe(bitmap)
    expect(globalThis.createImageBitmap).not.toHaveBeenCalled()
  })
})

describe('textureFromImageBitmap', () => {
  it('retains no bytes, since a bare bitmap has no source to re-encode', () => {
    const bitmap = new FakeImageBitmap() as unknown as ImageBitmap
    const tex = textureFromImageBitmap(bitmap, { srgb: false })
    expect(tex.image.bytes).toBeNull()
    expect(tex.image.bitmap).toBe(bitmap)
    expect(tex.srgb).toBe(false)
  })
})
