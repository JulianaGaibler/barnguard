import { describe, it, expect, vi, afterEach } from 'vitest'
import {
  _resetFontMetricsCacheForTests,
  _setSharedLabelCanvasForTests,
  clampLabelScale,
  fontMetrics,
  MAX_LABEL_TEXTURE_PX,
  measureLabel,
  measureText,
  rasterizeLabel,
  type LabelMeasureCtx,
  type LabelStyle,
} from './rasterizeLabel'

/**
 * Stub measure context that records the style it was given and returns canned
 * metrics. Mirrors the ctx-stub pattern in
 * `displays/stallwaechter/label.test.ts`.
 */
function stubCtx(metrics: Partial<TextMetrics>): {
  ctx: LabelMeasureCtx
  rec: { font: string; align: string; baseline: string }
} {
  const rec = { font: '', align: '', baseline: '' }
  const ctx: LabelMeasureCtx = {
    get font() {
      return rec.font
    },
    set font(v: string) {
      rec.font = v
    },
    get textAlign() {
      return rec.align as CanvasTextAlign
    },
    set textAlign(v: CanvasTextAlign) {
      rec.align = v
    },
    get textBaseline() {
      return rec.baseline as CanvasTextBaseline
    },
    set textBaseline(v: CanvasTextBaseline) {
      rec.baseline = v
    },
    measureText: () => metrics as TextMetrics,
  }
  return { ctx, rec }
}

const style = (over: Partial<LabelStyle> = {}): LabelStyle => ({
  font: '20px monospace',
  align: 'left',
  baseline: 'alphabetic',
  color: '#000',
  ...over,
})

describe('measureLabel', () => {
  it('applies font/align/baseline and uses actualBoundingBox metrics', () => {
    const { ctx, rec } = stubCtx({
      width: 40,
      actualBoundingBoxLeft: 0,
      actualBoundingBoxRight: 40,
      actualBoundingBoxAscent: 15,
      actualBoundingBoxDescent: 5,
    })
    const m = measureLabel(ctx, 'hello', style())
    expect(rec.font).toBe('20px monospace')
    expect(rec.align).toBe('left')
    expect(rec.baseline).toBe('alphabetic')
    // pad = 2 on each side.
    expect(m.localW).toBe(44) // 0 + 40 + 4
    expect(m.localH).toBe(24) // 15 + 5 + 4
    expect(m.anchorOffsetX).toBe(2) // left + pad
    expect(m.anchorOffsetY).toBe(17) // ascent + pad
  })

  it('falls back to width + fontSize heuristic when bounding box is missing', () => {
    // A stub with only `width` (old browsers / headless DOMs).
    const { ctx } = stubCtx({ width: 30 })
    const m = measureLabel(ctx, 'hi', style({ font: '10px sans-serif' }))
    // fallback: alphabetic → ascent 8, descent 2. align left → left 0, right 30.
    expect(m.localW).toBe(34) // 30 + 4
    expect(m.localH).toBe(14) // 8 + 2 + 4
    expect(m.anchorOffsetX).toBe(2)
    expect(m.anchorOffsetY).toBe(10) // 8 + 2
  })

  it('fallback centers the box for center align', () => {
    const { ctx } = stubCtx({ width: 30 })
    const m = measureLabel(
      ctx,
      'hi',
      style({ font: '10px x', align: 'center' }),
    )
    expect(m.anchorOffsetX).toBe(17) // 15 + pad
    expect(m.localW).toBe(34)
  })

  it('fallback splits height by baseline (middle)', () => {
    const { ctx } = stubCtx({ width: 30 })
    const m = measureLabel(
      ctx,
      'hi',
      style({ font: '10px x', baseline: 'middle' }),
    )
    expect(m.anchorOffsetY).toBe(7) // 5 + pad
    expect(m.localH).toBe(14) // 5 + 5 + 4
  })
})

describe('measureText', () => {
  // The test environment (happy-dom) has no real Canvas2D text engine, so
  // `getSharedCtx()` can't rasterize. These just pin the shape/null-safety of
  // the public entry point. `measureLabel`'s own describe block above covers
  // the actual metrics math against a stub ctx.
  it('returns a well-formed LabelMetrics box without throwing', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    const m = measureText('hello', style())
    expect(m).toEqual({
      localW: expect.any(Number),
      localH: expect.any(Number),
      advance: expect.any(Number),
      ascent: expect.any(Number),
      descent: expect.any(Number),
      anchorOffsetX: expect.any(Number),
      anchorOffsetY: expect.any(Number),
    })
    warn.mockRestore()
  })
})

describe('measureLabel ink metrics', () => {
  it('reports ascent and descent unpadded, unlike the bitmap box', () => {
    const { ctx } = stubCtx({
      width: 40,
      actualBoundingBoxLeft: 0,
      actualBoundingBoxRight: 40,
      actualBoundingBoxAscent: 15,
      actualBoundingBoxDescent: 5,
    })
    const m = measureLabel(ctx, 'hello', style())
    expect(m.ascent).toBe(15)
    expect(m.descent).toBe(5)
    // The bitmap box carries two pixels of transparent border on each side, so
    // sizing a chip from `localH` overshoots by four.
    expect(m.localH).toBe(m.ascent + m.descent + 4)
  })

  it('falls back to a size proportion when the platform reports no ink box', () => {
    const { ctx } = stubCtx({ width: 40 })
    const m = measureLabel(ctx, 'hello', style({ font: '20px monospace' }))
    expect(m.ascent).toBeCloseTo(16)
    expect(m.descent).toBeCloseTo(4)
  })
})

describe('fontMetrics', () => {
  afterEach(() => _resetFontMetricsCacheForTests())

  // happy-dom has no text engine, so this exercises the fallback path, which is
  // the one that has to stay finite: a NaN line height silently poisons every
  // position derived from it.
  it('never reports a non-finite metric', () => {
    const fm = fontMetrics('600 16px Inter, sans-serif')
    expect(Number.isFinite(fm.ascent)).toBe(true)
    expect(Number.isFinite(fm.descent)).toBe(true)
    expect(Number.isFinite(fm.capHeight)).toBe(true)
    expect(fm.lineHeight).toBeCloseTo(fm.ascent + fm.descent)
  })

  it('scales the fallback with the font size', () => {
    const small = fontMetrics('10px monospace')
    const large = fontMetrics('20px monospace')
    expect(large.lineHeight).toBeCloseTo(small.lineHeight * 2)
  })

  it('returns the same object for a repeated font', () => {
    expect(fontMetrics('12px monospace')).toBe(fontMetrics('12px monospace'))
  })
})

describe('clampLabelScale', () => {
  it('returns the scale unchanged when the texture fits', () => {
    expect(clampLabelScale(10, 4, 2)).toBe(2)
  })

  it('reduces the scale so an over-large label fits the cap', () => {
    const eff = clampLabelScale(10000, 4, 1, MAX_LABEL_TEXTURE_PX)
    expect(eff).toBeCloseTo(MAX_LABEL_TEXTURE_PX / 10000)
    expect(10000 * eff).toBeLessThanOrEqual(MAX_LABEL_TEXTURE_PX)
  })

  it('never returns a non-positive scale', () => {
    expect(clampLabelScale(0, 0, 0)).toBeGreaterThan(0)
  })
})

/**
 * A canvas and context stub recording the draw transform, so the raster path
 * can be exercised where there is no real text engine.
 */
function stubRasterTarget(metrics: Partial<TextMetrics>): {
  install: () => void
  restore: () => void
  calls: { transform: number[]; drawnAt: [number, number] }
} {
  const calls = {
    transform: [] as number[],
    drawnAt: [0, 0] as [number, number],
  }
  const canvas = { width: 1, height: 1 }
  const ctx = {
    font: '',
    textAlign: 'left' as CanvasTextAlign,
    textBaseline: 'alphabetic' as CanvasTextBaseline,
    fillStyle: '',
    measureText: () => metrics as TextMetrics,
    setTransform: (...m: number[]) => {
      calls.transform = m
    },
    fillText: (_t: string, x: number, y: number) => {
      calls.drawnAt = [x, y]
    },
  }
  return {
    install: () =>
      _setSharedLabelCanvasForTests(
        canvas as unknown as OffscreenCanvas,
        ctx as unknown as OffscreenCanvasRenderingContext2D,
      ),
    restore: () => _setSharedLabelCanvasForTests(null, null),
    calls,
  }
}

describe('rasterizeLabel', () => {
  // An ink box whose padded extent is fractional at the scale below, which is
  // where an unsnapped pen straddles a texel row.
  const ink = {
    width: 40.3,
    actualBoundingBoxLeft: 0,
    actualBoundingBoxRight: 40.3,
    actualBoundingBoxAscent: 15.4,
    actualBoundingBoxDescent: 4.7,
  }

  it('puts the pen on a whole device texel', () => {
    const t = stubRasterTarget(ink)
    t.install()
    const ras = rasterizeLabel('hello', style(), 1.7)!
    t.restore()
    expect(ras).not.toBeNull()
    // setTransform(eff, 0, 0, eff, penX, penY) and the pen drawn at the origin.
    const [a, , , d, penX, penY] = t.calls.transform
    expect(a).toBeCloseTo(1.7)
    expect(d).toBeCloseTo(1.7)
    expect(penX).toBe(Math.round(penX!))
    expect(penY).toBe(Math.round(penY!))
    expect(t.calls.drawnAt).toEqual([0, 0])
  })

  it('reports the anchor the pen actually landed on', () => {
    const t = stubRasterTarget(ink)
    t.install()
    const ras = rasterizeLabel('hello', style(), 1.7)!
    t.restore()
    const [, , , , penX, penY] = t.calls.transform
    expect(ras.anchorOffsetX * 1.7).toBeCloseTo(penX!)
    expect(ras.anchorOffsetY * 1.7).toBeCloseTo(penY!)
  })

  it('sizes localW/localH so the quad covers the texture exactly', () => {
    const t = stubRasterTarget(ink)
    t.install()
    const ras = rasterizeLabel('hello', style(), 2)!
    t.restore()
    // A quad of localW local units at a device scale of 2 is texW device px,
    // which is what makes the blit 1:1.
    expect(ras.localW * 2).toBeCloseTo(ras.texW)
    expect(ras.localH * 2).toBeCloseTo(ras.texH)
  })

  it('keeps the true ink metrics rather than the raster box', () => {
    const t = stubRasterTarget(ink)
    t.install()
    const ras = rasterizeLabel('hello', style(), 2)!
    t.restore()
    expect(ras.ascent).toBeCloseTo(15.4)
    expect(ras.descent).toBeCloseTo(4.7)
    expect(ras.advance).toBeCloseTo(40.3)
  })

  it('returns null with no canvas, so the caller draws nothing', () => {
    _setSharedLabelCanvasForTests(null, null)
    expect(rasterizeLabel('hello', style(), 1)).toBeNull()
  })
})
