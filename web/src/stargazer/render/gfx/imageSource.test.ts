import { describe, it, expect } from 'vitest'
import { resolveUploadFlipY, packUploadRGBA } from './imageSource'

// The single source of truth for texture-upload orientation. These pin the
// contract both backends depend on; a regression once inverted `flipY` on
// WebGPU only and rendered every label and image upside down (see
// resolveUploadFlipY's doc). If one of these fails because someone "fixed" an
// orientation bug by inverting the flip, the fix belongs in the caller's
// `flipY` or the shared projection, not here.
describe('resolveUploadFlipY', () => {
  it('passes flipY through unchanged (must never invert per backend)', () => {
    expect(resolveUploadFlipY({ flipY: true })).toBe(true)
    expect(resolveUploadFlipY({ flipY: false })).toBe(false)
  })

  it('defaults to no flip when omitted', () => {
    expect(resolveUploadFlipY({})).toBe(false)
  })
})

describe('packUploadRGBA', () => {
  // 1×2 image: top row red, bottom row blue, both opaque.
  const topRedBottomBlue = () => ({
    width: 1,
    height: 2,
    data: new Uint8ClampedArray([255, 0, 0, 255, 0, 0, 255, 255]),
  })

  it('preserves row order when flipY is false', () => {
    const out = packUploadRGBA(topRedBottomBlue(), { flipY: false })
    expect([...out]).toEqual([255, 0, 0, 255, 0, 0, 255, 255])
  })

  it('reverses rows when flipY is true', () => {
    const out = packUploadRGBA(topRedBottomBlue(), { flipY: true })
    // Top row becomes blue, bottom row becomes red.
    expect([...out]).toEqual([0, 0, 255, 255, 255, 0, 0, 255])
  })

  it('premultiplies rgb by alpha, leaving alpha intact', () => {
    const img = {
      width: 1,
      height: 1,
      data: new Uint8ClampedArray([200, 100, 50, 128]),
    }
    const out = packUploadRGBA(img, { premultiply: true })
    // s = 128/255; each channel * s, rounded.
    expect([...out]).toEqual([100, 50, 25, 128])
  })

  it('copies bytes verbatim with no flip and no premultiply', () => {
    const img = {
      width: 1,
      height: 1,
      data: new Uint8ClampedArray([200, 100, 50, 128]),
    }
    const out = packUploadRGBA(img, {})
    expect([...out]).toEqual([200, 100, 50, 128])
  })
})
