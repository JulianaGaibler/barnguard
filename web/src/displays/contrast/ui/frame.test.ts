import { describe, expect, it } from 'vitest'
import { pickFrame } from './frame'

describe('pickFrame', () => {
  it('is 1440 by 1080 on a 4:3 window', () => {
    expect(pickFrame(1024, 768)).toEqual({
      x: 0,
      y: 0,
      width: 1440,
      height: 1080,
    })
  })

  it('takes the window width on a wider one', () => {
    expect(pickFrame(1920, 1080).width).toBeCloseTo(1920)
    expect(pickFrame(1600, 1000).width).toBeCloseTo(1728)
  })

  it('stops at 2400', () => {
    expect(pickFrame(5000, 1000).width).toBe(2400)
  })

  it('keeps the 4:3 frame on a portrait window', () => {
    expect(pickFrame(768, 1024).width).toBe(1440)
    expect(pickFrame(768, 1024).height).toBe(1080)
  })

  it('has a frame before the canvas is measured', () => {
    expect(pickFrame(0, 0).width).toBe(1440)
  })
})
