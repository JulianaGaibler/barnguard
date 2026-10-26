import { describe, expect, it } from 'vitest'
import {
  COLUMN_GAP,
  TEXT_ONLY_WIDTH,
  answersHeight,
  DESIGN_LAYOUT,
  MIN_TAP_CSS_PX,
  NAV_HEIGHT,
  ROW_WIDTH,
  inWorld,
  layoutFor,
  tapHeight,
  type ScreenKind,
} from './layout'
import { pickFrame } from './frame'
import { MIN_ROW_GAP, TILE_SIZE, ROW_GAP } from './rowLayout'

/** The frame and layout of a window of this size in CSS pixels. */
function forWindow(
  width: number,
  height: number,
  screen: ScreenKind = 'picture',
) {
  const frame = pickFrame(width, height)
  const scale = Math.min(width / frame.width, height / frame.height)
  const area = {
    x: frame.width / 2 - width / scale / 2,
    y: frame.height / 2 - height / scale / 2,
    width: width / scale,
    height: height / scale,
  }
  const cssPxInWorld = 1 / scale
  const layout = layoutFor(area.width, area.height, frame, {
    screen,
    navHeight: tapHeight(NAV_HEIGHT, cssPxInWorld),
  })
  return { frame, area, scale, cssPxInWorld, layout }
}

describe('layoutFor', () => {
  it('is the design at 16:9', () => {
    expect(DESIGN_LAYOUT).toMatchObject({
      rowX: 128,
      rowWidth: 1664,
      trailY: 63,
      navY: 951,
      stacked: false,
    })
    expect(DESIGN_LAYOUT.content).toEqual({
      x: 128,
      y: 159,
      width: 1664,
      height: 760,
    })
    expect(DESIGN_LAYOUT.text).toEqual({
      x: 128,
      y: 159,
      width: 768,
      height: 760,
    })
    expect(DESIGN_LAYOUT.answers).toEqual({
      x: 1024,
      y: 159,
      width: 768,
      height: 760,
    })
    expect(DESIGN_LAYOUT.media).toEqual(DESIGN_LAYOUT.answers)
  })

  it('is the same at any 16:9 size where the buttons are big enough', () => {
    for (const [w, h] of [
      [1920, 1080],
      [2560, 1440],
      [3840, 2160],
    ]) {
      const { layout } = forWindow(w, h)
      expect(layout.content).toEqual(DESIGN_LAYOUT.content)
      expect(layout.navY).toBe(951)
    }
  })

  it('keeps the row 1664 wide and centers it on a wide window', () => {
    const { layout } = forWindow(2560, 1080)
    expect(layout.width).toBeCloseTo(2560)
    expect(layout.rowWidth).toBe(ROW_WIDTH)
    expect(layout.rowX).toBeCloseTo((2560 - 1664) / 2)
    expect(layout.answers.x - (layout.text.x + layout.text.width)).toBe(
      COLUMN_GAP,
    )
    expect(layout.content.height).toBe(760)
    expect(layout.navY).toBe(951)
  })

  it('narrows the row on a narrower frame', () => {
    const { frame, layout } = forWindow(1194, 834)
    expect(frame.width).toBeCloseTo(1546.19, 1)
    expect(layout.rowWidth).toBeCloseTo(frame.width - 256, 6)
    const narrow = forWindow(1100, 1000).layout
    expect(narrow.stacked).toBe(false)
    expect(narrow.rowWidth).toBe(1440 - 256)
    expect(narrow.text.width * 2 + COLUMN_GAP).toBe(narrow.rowWidth)
  })

  it('splits the row into two equal columns around the gap', () => {
    const { layout } = forWindow(1500, 1000)
    expect(layout.text.width).toBe(layout.answers.width)
    expect(layout.text.width * 2 + COLUMN_GAP).toBe(layout.rowWidth)
  })

  it('keeps the progress row and the buttons off the content', () => {
    for (const [w, h] of [
      [1920, 1080],
      [1194, 834],
      [1100, 1080],
      [1920, 640],
      [834, 1194],
      [390, 844],
    ]) {
      const { layout } = forWindow(w, h)
      expect(layout.content.y).toBeGreaterThan(layout.trailY + 36)
      expect(layout.content.y + layout.content.height).toBeLessThan(layout.navY)
    }
  })

  it('never goes negative for an area smaller than the design', () => {
    const layout = layoutFor(200, 100, { width: 1920, height: 1080 })
    expect(layout.rowWidth).toBe(0)
    expect(layout.content.height).toBe(0)
  })

  it('keeps clear of the safe area', () => {
    const insets = { top: 40, right: 0, bottom: 30, left: 0 }
    const plain = layoutFor(1920, 1080, { width: 1920, height: 1080 })
    const safe = layoutFor(
      1920,
      1080,
      { width: 1920, height: 1080 },
      { insets },
    )
    expect(safe.trailY).toBe(plain.trailY + 40)
    expect(safe.navY).toBe(plain.navY - 30)
  })
})

describe('layoutFor on a small 16:9 window', () => {
  it('makes the buttons tall enough to tap and gives them the room', () => {
    const { layout } = forWindow(1280, 720)
    expect(layout.navHeight).toBe(72)
    expect(layout.navY + layout.navHeight).toBe(1080 - 65)
    expect(layout.content.height).toBe(760 - 8)
  })
})

describe('layoutFor in one column', () => {
  it('stacks the text above the answers of a choice', () => {
    const { layout } = forWindow(390, 844, 'choice')
    expect(layout.stacked).toBe(true)
    expect(layout.text.y + layout.text.height).toBeLessThan(layout.answers.y)
    expect(layout.text.x).toBe(layout.answers.x)
    expect(layout.text.width).toBe(layout.rowWidth)
  })

  it('puts the picture above the text', () => {
    const { layout } = forWindow(390, 844, 'picture')
    expect(layout.media.y + layout.media.height).toBeLessThan(layout.text.y)
    expect(layout.text.y + layout.text.height).toBeCloseTo(
      layout.content.y + layout.content.height,
    )
  })

  it('gives the text the whole column when there is nothing else', () => {
    const { layout } = forWindow(390, 844, 'text')
    expect(layout.text).toEqual(layout.content)
  })

  it('is 832 wide in a 960 wide frame', () => {
    expect(forWindow(390, 844).layout.rowWidth).toBe(832)
  })
})

/** The device matrix: CSS pixel sizes of the screens the display targets. */
const DEVICES: ReadonlyArray<readonly [string, number, number, boolean]> = [
  ['desktop 16:9', 1920, 1080, false],
  ['iPad landscape', 1194, 834, false],
  ['iPad mini landscape', 1133, 744, false],
  ['iPad portrait', 834, 1194, true],
  ['iPhone', 390, 844, true],
  ['iPhone SE', 375, 667, true],
]

describe.each(DEVICES)('on a %s', (_name, w, h, stacked) => {
  const { layout, scale, cssPxInWorld, area } = forWindow(w, h, 'choice')

  it('uses the layout for its shape', () => {
    expect(layout.stacked).toBe(stacked)
  })

  it('keeps text a readable size', () => {
    // Body text is 44 design pixels and answer text is 40.
    expect(40 * scale).toBeGreaterThanOrEqual(15)
  })

  it('keeps tap targets at least 44 CSS pixels', () => {
    expect(layout.navHeight * scale).toBeGreaterThanOrEqual(44)
    expect(tapHeight(TILE_SIZE, cssPxInWorld) * scale).toBeGreaterThanOrEqual(
      44,
    )
    expect(cssPxInWorld).toBeCloseTo(1 / scale, 9)
  })

  it('fits four answers in the answers box', () => {
    const need = 4 * tapHeight(TILE_SIZE, cssPxInWorld) + 3 * MIN_ROW_GAP
    expect(layout.answers.height).toBeGreaterThanOrEqual(need)
  })

  it('keeps every box inside the visible area', () => {
    for (const box of [layout.content, layout.text, layout.answers]) {
      expect(box.x).toBeGreaterThanOrEqual(-1e-9)
      expect(box.y).toBeGreaterThanOrEqual(-1e-9)
      expect(box.x + box.width).toBeLessThanOrEqual(area.width + 1e-9)
      expect(box.y + box.height).toBeLessThanOrEqual(area.height + 1e-9)
    }
    expect(layout.navY + layout.navHeight).toBeLessThanOrEqual(area.height)
  })
})

describe('tapHeight', () => {
  it('keeps the design height where it is big enough', () => {
    expect(tapHeight(NAV_HEIGHT, 1)).toBe(NAV_HEIGHT)
  })

  it('raises a height that would be too small on screen', () => {
    expect(tapHeight(NAV_HEIGHT, 2)).toBe(MIN_TAP_CSS_PX * 2)
  })
})

describe('inWorld', () => {
  it('moves a box by the visible area origin', () => {
    const { area, layout } = forWindow(1920, 640)
    const box = inWorld(layout.answers, area)
    expect(box.x).toBeCloseTo(layout.answers.x + area.x)
    expect(box.y).toBeCloseTo(layout.answers.y + area.y)
    expect(box.width).toBe(layout.answers.width)
  })
})

describe('layoutFor with only text', () => {
  it('gives the text a wider column and leaves nothing beside it', () => {
    const { layout } = forWindow(1920, 1080, 'text')
    expect(layout.text.width).toBe(TEXT_ONLY_WIDTH)
    expect(layout.text.x).toBe(layout.rowX)
    expect(layout.media).toEqual(layout.text)
  })

  it('keeps a text screen within the row on a narrower frame', () => {
    const { layout } = forWindow(1100, 1000, 'text')
    expect(layout.text.width).toBeLessThanOrEqual(layout.rowWidth)
  })
})

describe('answersHeight', () => {
  it('is as tall as its lines of text, with the gaps', () => {
    // At 40 pixels a one line answer is 52 - 0.35 * 40 + 0.7 * 40 = 66 tall,
    // taller than the 56 pixel square.
    expect(answersHeight([20, 20, 20], 832, TILE_SIZE)).toBeCloseTo(
      3 * 66 + 2 * ROW_GAP,
    )
  })

  it('is as tall as the tap target when the text is shorter', () => {
    expect(answersHeight([20], 832, 120)).toBe(120)
  })

  it('grows with the lines a long answer needs', () => {
    const one = answersHeight([20], 832, TILE_SIZE)
    const many = answersHeight([200], 832, TILE_SIZE)
    expect(many).toBeGreaterThan(one)
  })

  it('needs less room for smaller text', () => {
    expect(answersHeight([200], 832, TILE_SIZE, 28)).toBeLessThan(
      answersHeight([200], 832, TILE_SIZE, 40),
    )
  })
})

describe('layoutFor a choice on one column', () => {
  const frame = { width: 960, height: 1707 }

  it('gives the answers what they need and the text the rest', () => {
    const lean = layoutFor(960, 1707, frame, {
      screen: 'choice',
      answers: [20, 20],
    })
    const roomy = layoutFor(960, 1707, frame, { screen: 'choice' })
    expect(lean.answers.height).toBe(answersHeight([20, 20], 832, TILE_SIZE))
    expect(lean.text.height).toBeGreaterThan(roomy.text.height)
    expect(lean.text.y + lean.text.height).toBeLessThan(lean.answers.y)
  })

  it('never lets the answers take more than 55 percent of the column', () => {
    const layout = layoutFor(960, 1707, frame, {
      screen: 'choice',
      answers: [400, 400, 400, 400],
    })
    expect(layout.answers.height).toBeCloseTo(layout.content.height * 0.55)
  })
})
