import { describe, expect, it } from 'vitest'
import { isStacked, pickFrame } from './frame'

describe('pickFrame', () => {
  it('is 1920 by 1080 at 16:9 and on an empty canvas', () => {
    expect(pickFrame(1280, 720)).toEqual({
      x: 0,
      y: 0,
      width: 1920,
      height: 1080,
    })
    expect(pickFrame(0, 0)).toEqual(pickFrame(1920, 1080))
  })

  it('takes the shape of a window wider than tall, up to the limits', () => {
    expect(pickFrame(1194, 834).width).toBeCloseTo(1546.19, 1)
    expect(pickFrame(1000, 1000).width).toBe(1440)
    expect(pickFrame(3000, 1000).width).toBe(1920)
    expect(pickFrame(1194, 834).height).toBe(1080)
  })

  it('is 960 wide on a window taller than wide', () => {
    expect(pickFrame(390, 844)).toMatchObject({
      width: 960,
      height: 960 / (390 / 844),
    })
    expect(pickFrame(834, 1194)).toMatchObject({ width: 960, height: 1600 })
    expect(pickFrame(375, 667)).toMatchObject({
      width: 960,
      height: 960 / (375 / 667),
    })
  })

  it('limits how tall the frame gets', () => {
    expect(pickFrame(300, 1000).height).toBe(2080)
  })
})

describe('isStacked', () => {
  it('is true for a frame taller than wide', () => {
    expect(isStacked(pickFrame(390, 844))).toBe(true)
    expect(isStacked(pickFrame(834, 1194))).toBe(true)
    expect(isStacked(pickFrame(1194, 834))).toBe(false)
    expect(isStacked(pickFrame(1000, 1000))).toBe(false)
  })
})
