import { describe, expect, it } from 'vitest'
import type { PostPassContext } from 'stargazer'
import { SliceShift } from './SliceShift'

function ctx(uvYDown: boolean): PostPassContext {
  return {
    width: 100,
    height: 50,
    texelW: 1 / 100,
    texelH: 1 / 50,
    inputWidth: 100,
    inputHeight: 50,
    inputTexelW: 1 / 100,
    inputTexelH: 1 / 50,
    uvYDown,
    time: 0,
    dt: 0,
    source: {
      width: 100,
      height: 50,
      originX: 0,
      originY: 0,
      pxPerUnit: 1,
      unitOriginX: 0,
      unitOriginY: 0,
    },
  }
}

describe('SliceShift', () => {
  it('defaults match the Figma shader', () => {
    const e = new SliceShift()
    expect(e.shift).toBe(50)
    expect(e.angle).toBe(0)
    expect(e.centerX).toBe(50)
    expect(e.centerY).toBe(50)
    expect(e.barWidth).toBe(100)
    expect(e.passes).toHaveLength(1)
  })

  it('writes shift as a fraction of barWidth', () => {
    const e = new SliceShift({ shift: 50, barWidth: 10 })
    const out = new Float32Array(8)
    e.passes[0].writeParams!(ctx(true), out)
    expect(out[6]).toBe(10) // barWidth
    expect(out[7]).toBeCloseTo(0.5) // shift * 0.01
  })

  it('derives barWidth from columns, overriding a fixed barWidth', () => {
    const e = new SliceShift({ barWidth: 999, columns: 11 })
    const out = new Float32Array(8)
    e.passes[0].writeParams!(ctx(true), out)
    expect(out[6]).toBeCloseTo(100 / 11) // ctx.width / columns
  })

  it('recomputes the column width as the frame width changes', () => {
    const e = new SliceShift({ columns: 10 })
    const out = new Float32Array(8)
    e.passes[0].writeParams!(ctx(true), out)
    expect(out[6]).toBeCloseTo(10) // 100 / 10
    e.passes[0].writeParams!({ ...ctx(true), width: 200 }, out)
    expect(out[6]).toBeCloseTo(20) // 200 / 10, same column count
  })

  it('falls back to barWidth when columns is null', () => {
    const e = new SliceShift({ barWidth: 25, columns: null })
    const out = new Float32Array(8)
    e.passes[0].writeParams!(ctx(true), out)
    expect(out[6]).toBe(25)
  })

  it('angle 0 leaves the rotation identity on both backends', () => {
    const e = new SliceShift({ angle: 0 })
    const out = new Float32Array(8)
    e.passes[0].writeParams!(ctx(true), out)
    expect(out[0]).toBeCloseTo(1) // cos
    expect(out[1]).toBeCloseTo(0) // sin
    e.passes[0].writeParams!(ctx(false), out)
    expect(out[0]).toBeCloseTo(1)
    expect(out[1]).toBeCloseTo(0)
  })

  it('flips the angle and the anchor Y when uv grows upward (WebGL2)', () => {
    const e = new SliceShift({ angle: 30, centerX: 20, centerY: 70 })
    const gpuOut = new Float32Array(8)
    e.passes[0].writeParams!(ctx(true), gpuOut)
    const glOut = new Float32Array(8)
    e.passes[0].writeParams!(ctx(false), glOut)

    // centerX is unaffected; centerY mirrors around 50.
    expect(gpuOut[4]).toBe(glOut[4])
    expect(glOut[5]).toBeCloseTo(100 - 70)

    // Negating the angle before Figma's own negation flips the sign of sin,
    // leaving cos unchanged.
    expect(glOut[0]).toBeCloseTo(gpuOut[0])
    expect(glOut[1]).toBeCloseTo(-gpuOut[1])
  })
})
