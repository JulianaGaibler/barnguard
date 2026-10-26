import { describe, expect, it } from 'vitest'
import {
  COLUMN_GAP,
  TEXT_ONLY_WIDTH,
  answersHeight,
  answersRowHeight,
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
import { MIN_ROW_GAP, ROW_GAP, TILE_SIZE } from './rowLayout'

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
      height: 856,
    })
    expect(DESIGN_LAYOUT.text).toEqual({
      x: 128,
      y: 159,
      width: 768,
      height: 856,
    })
    expect(DESIGN_LAYOUT.answers).toEqual({
      x: 1024,
      y: 159,
      width: 768,
      height: 856,
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
    expect(layout.content.height).toBe(856)
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
      expect(layout.content.y + layout.content.height).toBeLessThan(
        layout.height,
      )
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
    expect(layout.content.height).toBe(856)
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
  const textOnly = (choices: 'side' | 'below') => {
    return layoutFor(1920, 1080, pickFrame(1920, 1080), {
      screen: 'text',
      choices,
    })
  }

  it('gives the text a wider column and leaves nothing beside it', () => {
    const { layout } = forWindow(1920, 1080, 'text')
    expect(layout.text.width).toBe(TEXT_ONLY_WIDTH)
    expect(layout.text.x).toBe(layout.rowX)
    expect(layout.centered).toBe(false)
    expect(layout.media).toEqual(layout.text)
  })

  it('centers the column once the progress row is gone', () => {
    const layout = textOnly('below')
    expect(layout.text.x + layout.text.width / 2).toBeCloseTo(
      layout.rowX + layout.rowWidth / 2,
    )
    expect(layout.centered).toBe(true)
  })

  it('keeps a text screen within the row on a narrower frame', () => {
    const { layout } = forWindow(1100, 1000, 'text')
    expect(layout.text.width).toBeLessThanOrEqual(layout.rowWidth)
  })
})

describe('answersHeight', () => {
  it('is as tall as the tap target for short answers, with the gaps', () => {
    // At 36 pixels a one line answer is 52 - 0.35 * 36 + 1.25 * 36 = 84.4 tall,
    // taller than the square.
    expect(answersHeight([20, 20, 20], 832, 56)).toBeCloseTo(
      3 * 84.4 + 2 * ROW_GAP,
    )
    expect(answersHeight([20], 832, 120)).toBe(120)
  })

  it('grows with the lines a long answer needs', () => {
    // 75 characters of 18 pixels need two lines in 728.
    expect(answersHeight([75], 832, 56)).toBeCloseTo(52 - 12.6 + 2 * 45)
    expect(answersHeight([75], 832, 56)).toBeGreaterThan(
      answersHeight([20], 832, 56),
    )
  })

  it('needs less room for smaller text', () => {
    expect(answersHeight([75], 832, 56, 28)).toBeLessThan(
      answersHeight([75], 832, 56, 36),
    )
  })
})

describe('layoutFor a choice on one column', () => {
  const frame = { width: 960, height: 1707 }
  const area = { width: 960, height: 1707 }

  it('gives the answers what they need and the text the rest', () => {
    const lean = layoutFor(area.width, area.height, frame, {
      screen: 'choice',
      answers: [20, 20, 20],
    })
    const roomy = layoutFor(area.width, area.height, frame, {
      screen: 'choice',
    })
    expect(lean.answers.height).toBe(answersHeight([20, 20, 20], 832, 56))
    expect(lean.text.height).toBeGreaterThan(roomy.text.height)
    expect(lean.text.y + lean.text.height).toBeLessThan(lean.answers.y)
  })

  it('never lets the answers take more than 60 percent of the column', () => {
    const layout = layoutFor(area.width, area.height, frame, {
      screen: 'choice',
      answers: [400, 400, 400, 400],
    })
    expect(layout.answers.height).toBeCloseTo(layout.content.height * 0.6)
  })
})

describe('layoutFor a choice below the text', () => {
  const frame = { width: 1920, height: 1080 }
  const short = [30, 40, 35]

  const below = (answers: readonly number[], size = frame) =>
    layoutFor(size.width, size.height, size, {
      screen: 'choice',
      choices: 'below',
      answers,
    })

  it('puts the text on top and the answers under it', () => {
    const layout = below(short)
    expect(layout.text.y + layout.text.height).toBeLessThan(layout.answers.y)
    expect(layout.text.width).toBe(TEXT_ONLY_WIDTH)
    expect(layout.answers.y + layout.answers.height).toBeCloseTo(
      layout.content.y + layout.content.height,
    )
  })

  it('stands the answers side by side when each can have a column', () => {
    const layout = below(short)
    expect(layout.answersRow).toBe(true)
    expect(layout.answers.width).toBe(layout.rowWidth)
    expect(layout.answers.height).toBeCloseTo(
      answersRowHeight(short, (1664 - 2 * 48) / 3, 56),
    )
  })

  it('stacks the answers when the columns would be too narrow', () => {
    const narrow = { width: 1440, height: 1080 }
    const layout = below([30, 40, 35, 30], narrow)
    // Four answers in a 1184 wide row are 260 wide each.
    expect(layout.answersRow).toBe(false)
    expect(layout.answers.width).toBe(TEXT_ONLY_WIDTH)
    // They take what they need, up to 60 percent of the content.
    expect(layout.answers.height).toBeCloseTo(
      Math.min(
        answersHeight([30, 40, 35, 30], TEXT_ONLY_WIDTH, 56),
        layout.content.height * 0.6,
      ),
    )
  })

  it('stands two answers side by side on the narrower frame too', () => {
    expect(below([30, 40], { width: 1440, height: 1080 }).answersRow).toBe(true)
  })

  it('keeps the side layout unless the answers are asked to go below', () => {
    const side = layoutFor(1920, 1080, frame, {
      screen: 'choice',
      answers: short,
    })
    expect(side.answersRow).toBe(false)
    expect(side.answers.x).toBeGreaterThan(side.text.x + side.text.width)
  })

  it('leaves one column as it is, which always has the answers below', () => {
    const phone = { width: 960, height: 1707 }
    const layout = layoutFor(960, 1707, phone, {
      screen: 'choice',
      choices: 'below',
      answers: short,
    })
    expect(layout.answersRow).toBe(false)
    expect(layout.text.y + layout.text.height).toBeLessThan(layout.answers.y)
  })

  it('keeps the boxes inside the content and apart', () => {
    for (const answers of [short, [200, 200, 200], [30, 40, 35, 30]]) {
      const layout = below(answers)
      expect(layout.text.y).toBeGreaterThanOrEqual(layout.content.y)
      expect(layout.text.height).toBeGreaterThan(0)
      expect(layout.answers.y + layout.answers.height).toBeLessThanOrEqual(
        layout.content.y + layout.content.height + 1e-9,
      )
    }
  })
})
