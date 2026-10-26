import { describe, expect, it } from 'vitest'
import { bodyCssPx, fitText, textRange, type Fittable } from './fitText'

/** A box whose text is `perPixel` tall for every pixel of font size. */
function box(boxHeight: number, perPixel: number) {
  let size = 0
  const element: Fittable & { size: number; sets: number } = {
    sets: 0,
    get size() {
      return size
    },
    style: {
      setProperty: (_name, value) => {
        size = parseFloat(value)
        element.sets++
      },
    },
    get scrollHeight() {
      return Math.max(size * perPixel, boxHeight)
    },
    get clientHeight() {
      return boxHeight
    },
  }
  return element
}

describe('fitText', () => {
  it('takes the maximum when the text fits at it', () => {
    const element = box(1000, 5)
    expect(fitText(element, 30, 44)).toBe(44)
    expect(element.size).toBe(44)
  })

  it('finds the largest size that fits', () => {
    const element = box(400, 10)
    expect(fitText(element, 20, 64)).toBe(40)
    expect(element.size).toBe(40)
  })

  it('takes the minimum when nothing fits, and leaves the box to scroll', () => {
    const element = box(100, 10)
    expect(fitText(element, 30, 44)).toBe(30)
    expect(element.size).toBe(30)
  })

  it('with a line that must fit across, takes the size at which it does', () => {
    const element = box(1000, 5)
    const line = {
      get scrollWidth() {
        return Math.max(element.size * 20, 600)
      },
      clientWidth: 600,
    }
    expect(fitText(element, 20, 44, { across: line })).toBe(30)
  })

  it('takes few passes', () => {
    const element = box(400, 10)
    fitText(element, 20, 64)
    expect(element.sets).toBeLessThanOrEqual(10)
  })
})

describe('bodyCssPx', () => {
  it('is 20 on a phone and grows with the window to 32 at 1920', () => {
    expect(bodyCssPx(390)).toBe(20)
    expect(bodyCssPx(320)).toBe(20)
    expect(bodyCssPx(834)).toBeCloseTo(23.5, 1)
    expect(bodyCssPx(1440)).toBeCloseTo(28.2, 1)
    expect(bodyCssPx(1920)).toBeCloseTo(32, 0)
  })

  it('stops growing on a very large screen', () => {
    expect(bodyCssPx(5000)).toBe(34)
  })
})

describe('textRange', () => {
  it('is the body size in design pixels, and a few words are larger', () => {
    // A 1920 wide screen is one design pixel to a CSS pixel.
    const body = textRange(400, 1, 1920)
    expect(body.max).toBeCloseTo(32, 0)
    expect(textRange(60, 1, 1920).max).toBeCloseTo(body.max * 1.35)
    expect(textRange(60, 1, 1920, false).max).toBe(body.max)
  })

  it('scales with the design pixels in a CSS pixel', () => {
    const phone = textRange(400, 960 / 390, 390)
    expect(phone.max).toBeCloseTo(20 * (960 / 390))
  })

  it('shrinks a phone about as far as a big screen before it scrolls', () => {
    const phone = textRange(400, 1, 390)
    const wide = textRange(400, 1, 1920)
    expect(phone.min / phone.max).toBeCloseTo(0.75)
    expect(wide.min / wide.max).toBeCloseTo(0.78)
  })
})
