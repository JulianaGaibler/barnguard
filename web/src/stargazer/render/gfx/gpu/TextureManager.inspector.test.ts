import { describe, it, expect, vi, beforeEach } from 'vitest'

// Mock the rasterizer so the inspector logic runs without a real 2D canvas.
// A `vi.hoisted` fn lets the tests assert how `renderLabelPreview` calls it.
const { rasterizeLabelMock } = vi.hoisted(() => ({
  rasterizeLabelMock: vi.fn(
    (_text: string, _style: unknown, scale: number) => ({
      canvas: {} as HTMLCanvasElement,
      texW: Math.max(1, Math.round(10 * scale)),
      texH: Math.max(1, Math.round(4 * scale)),
      localW: 10,
      localH: 4,
      anchorOffsetX: 1,
      anchorOffsetY: 3,
    }),
  ),
}))

vi.mock('../rasterizeLabel', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../rasterizeLabel')>()
  return { ...actual, rasterizeLabel: rasterizeLabelMock }
})

import { TextureManager } from './TextureManager'
import { MockGfxDevice } from './webgl2/mockGfxDevice'
import type { LabelStyle } from '../rasterizeLabel'

const style: LabelStyle = {
  font: '10px x',
  align: 'left',
  baseline: 'alphabetic',
  color: '#000',
}

/** Mirror the baseKey format `GpuGfx.fillText` builds (trailing newline). */
function baseKey(text: string, s: LabelStyle): string {
  return `${text}\n${s.font}\n${s.align}\n${s.baseline}\n${s.color}\n`
}

/** Bucket ratio (kept in sync with TextureManager's `LABEL_SCALE_BUCKET_RATIO`). */
const RATIO = 2 ** (1 / 3)

let device: MockGfxDevice
let tm: TextureManager

beforeEach(() => {
  device = new MockGfxDevice()
  tm = new TextureManager(device)
  rasterizeLabelMock.mockClear()
})

describe('TextureManager.snapshot', () => {
  it('reports an empty atlas before any sprite is registered', () => {
    const snap = tm.snapshot()
    expect(snap.atlas.used).toBe(0)
    expect(snap.atlas.full).toBe(false)
    expect(snap.atlas.canvas).toBeNull()
    expect(snap.atlas.capacity).toBeGreaterThan(0)
  })

  it('recovers a label text + style from its cache key', () => {
    tm.ensureLabelTexture(baseKey('hi', style), 'hi', style, 2)
    const snap = tm.snapshot()
    expect(snap.labelCount).toBe(1)
    expect(snap.labelCap).toBeGreaterThan(0)
    const l = snap.labels[0]
    expect(l).toMatchObject({
      text: 'hi',
      font: '10px x',
      align: 'left',
      baseline: 'alphabetic',
      color: '#000',
    })
    expect(Number.isInteger(l.bucket)).toBe(true)
    // texW/texH come from the (mocked) rasterization; both positive.
    expect(l.texW).toBeGreaterThan(0)
    expect(l.texH).toBeGreaterThan(0)
  })

  it('lists per-source textures with their dimensions', () => {
    const src = { width: 8, height: 12 } as unknown as CanvasImageSource
    tm.getOrCreateEntry(src)
    const snap = tm.snapshot()
    expect(snap.perSource).toHaveLength(1)
    expect(snap.perSource[0]).toMatchObject({
      width: 8,
      height: 12,
      source: src,
    })
  })
})

describe('TextureManager.renderLabelPreview', () => {
  it('returns null for an unparseable key and does not rasterize', () => {
    expect(tm.renderLabelPreview('not-a-real-key')).toBeNull()
    expect(rasterizeLabelMock).not.toHaveBeenCalled()
  })

  it('re-rasterizes the parsed label at its (positive) bucket scale', () => {
    tm.renderLabelPreview(`${baseKey('hi', style)}-3`)
    expect(rasterizeLabelMock).toHaveBeenCalledTimes(1)
    const [text, passedStyle, scale] = rasterizeLabelMock.mock.calls[0]
    expect(text).toBe('hi')
    expect(passedStyle).toMatchObject(style)
    expect(scale as number).toBeCloseTo(RATIO ** 3, 5) // == 2
  })

  it('parses a negative bucket (sub-1× device scale)', () => {
    tm.renderLabelPreview(`${baseKey('lo', style)}--2`)
    expect(rasterizeLabelMock).toHaveBeenCalledTimes(1)
    const [text, , scale] = rasterizeLabelMock.mock.calls[0]
    expect(text).toBe('lo')
    expect(scale as number).toBeCloseTo(RATIO ** -2, 5)
  })
})
