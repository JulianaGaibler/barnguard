import { describe, it, expect } from 'vitest'
import {
  measureLabel,
  clampLabelScale,
  MAX_LABEL_TEXTURE_PX,
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
    // fallback: alphabetic → ascent 8, descent 2; align left → left 0, right 30.
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
