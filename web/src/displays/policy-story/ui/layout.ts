import type { Rect } from 'stargazer'
import { DESIGN_HEIGHT, DESIGN_WIDTH } from '@src/core/ui/designRegion'
import type { UiRegion } from '@src/core/ui/uiRegion.svelte'
import { isStacked } from './frame'
import { ANSWER_COLUMN_GAP, ROW_GAP, TILE_SIZE } from './rowLayout'
import { NO_INSETS, readSafeArea, scaleInsets, type Insets } from './safeArea'

/** Width of the row the screens' content sits in, in design pixels. */
export const ROW_WIDTH = 1664
/** The least space left and right of the row. */
const MIN_MARGIN = 128
/** Space between the two columns of the row. */
export const COLUMN_GAP = 128
/** Where the progress row starts, from the top. */
export const TRAIL_TOP = 63
/** Where the content starts, from the top. */
const CONTENT_TOP = 159
/** The button row, and the space under it. */
export const NAV_HEIGHT = 64
const NAV_BOTTOM = DESIGN_HEIGHT - 951 - NAV_HEIGHT

/** How wide a screen with only text sets it, so the lines stay readable. */
export const TEXT_ONLY_WIDTH = 980

/** The least space left and right of the column on a portrait screen. */
const STACK_MARGIN = 64
/** Space between the parts of the column on a portrait screen. */
export const STACK_GAP = 64
/** The share of the column a picture takes, above the text. */
const STACK_MEDIA_SHARE = 0.4
/** The narrowest an answer may be to stand beside others, in design pixels. */
const MIN_ANSWER_COLUMN = 340
/** The most of the column the answers may take, under the text. */
const STACK_ANSWERS_SHARE = 0.6
/** The width of the text beside an answer's square, less its padding. */
const ANSWER_TEXT_INSET = 56 + 48
/** An answer's character is this wide and its line this tall, in ems. */
const ANSWER_CHARACTER_EM = 0.53
const ANSWER_LINE_EM = 1.25
/** What an answer adds to its lines, less 0.35 em, which centers the first line. */
const ANSWER_PADDING = 52
/** The font size of an answer when the caller gives none, in design pixels. */
export const ANSWER_SIZE = 36

/** The least height of a tap target, in CSS pixels. */
export const MIN_TAP_CSS_PX = 48

/** A box, from the top left of the visible area, in design pixels. */
export type Box = Pick<Rect, 'x' | 'y' | 'width' | 'height'>

/** What a screen shows besides its text, which decides how it is split. */
export type ScreenKind = 'choice' | 'picture' | 'text'

export interface LayoutOptions {
  /** Default `'text'`. */
  screen?: ScreenKind
  /** The height of the button row. Default {@link NAV_HEIGHT}. */
  navHeight?: number
  /** Space kept clear on each edge, in design pixels. Default none. */
  insets?: Insets
  /**
   * The characters of each answer's text on a choice. On one column the answers
   * get the room they need and the text gets the rest. Without it they get most
   * of the column.
   */
  answers?: readonly number[]
  /** The least height of an answer, in design pixels. Default the square's. */
  answerMinHeight?: number
  /** The font size of an answer's text, in design pixels. */
  answerSize?: number
  /**
   * Where the answers of a choice go on two columns: `side` puts them in the
   * right column and `below` puts them under the text, side by side when each
   * can have room enough, and stacked when not. Default `side`. One column
   * always has them below.
   */
  choices?: 'side' | 'below'
}

/**
 * The height `answers` need in a column `width` wide, for text `size` design
 * pixels high: each as tall as its lines of text, or `minHeight`, and a gap
 * between them.
 */
export function answersHeight(
  answers: readonly number[],
  width: number,
  minHeight: number,
  size: number = ANSWER_SIZE,
): number {
  const rows = answers.map((characters) =>
    answerHeight(characters, width, minHeight, size),
  )
  const heights = rows.reduce((sum, height) => sum + height, 0)
  return heights + ROW_GAP * Math.max(rows.length - 1, 0)
}

/**
 * The height `answers` need standing side by side, each `width` wide: that of
 * the tallest.
 */
export function answersRowHeight(
  answers: readonly number[],
  width: number,
  minHeight: number,
  size: number = ANSWER_SIZE,
): number {
  return Math.max(
    minHeight,
    ...answers.map((characters) =>
      answerHeight(characters, width, minHeight, size),
    ),
  )
}

/** The height of one answer of `characters` characters in a column `width` wide. */
function answerHeight(
  characters: number,
  width: number,
  minHeight: number,
  size: number,
): number {
  const character = size * ANSWER_CHARACTER_EM
  const room = Math.max(width - ANSWER_TEXT_INSET, character)
  const padding = ANSWER_PADDING - 0.35 * size
  const lines = Math.max(1, Math.ceil((characters * character) / room))
  return Math.max(minHeight, padding + lines * size * ANSWER_LINE_EM)
}

/** Where everything on a screen goes, for one visible area. */
export interface ScreenLayout {
  /** The visible area. */
  width: number
  height: number
  /** True when the screen is one column, with the parts stacked. */
  stacked: boolean
  /** The row the content sits in, centered. */
  rowX: number
  rowWidth: number
  trailY: number
  navY: number
  navHeight: number
  /** Everything between the progress row and the buttons. */
  content: Box
  /** The screen's text. */
  text: Box
  /** The picture or the animation. */
  media: Box
  /** The answers of a choice. */
  answers: Box
  /** True when the answers stand side by side, each in a column of the box. */
  answersRow: boolean
  /**
   * True when the answers are under the text, which then sits at the bottom of
   * its box so the two stay together.
   */
  answersBelow: boolean
  /**
   * True when the text, the answers and the button are centered, which they are
   * once the progress row is gone. Before that they start at the left.
   */
  centered: boolean
}

/**
 * Lays the screens out in a visible area of `width` by `height` design pixels,
 * for the frame {@link pickFrame} chose. A frame wider than tall gives two
 * columns: the text on the left, and the picture or the answers on the right,
 * or a single wider column of text when there is nothing for the right. A
 * taller frame gives one column, with the picture above the text, or the
 * answers below it.
 *
 * The progress row hugs the top and the buttons hug the bottom. Extra width
 * becomes margin and extra height goes to the content, which centers what it
 * holds. At 1920 by 1080 every number is the design's.
 */
export function layoutFor(
  width: number,
  height: number,
  frame: Pick<Rect, 'width' | 'height'>,
  opts: LayoutOptions = {},
): ScreenLayout {
  const screen = opts.screen ?? 'text'
  const navHeight = opts.navHeight ?? NAV_HEIGHT
  const insets = opts.insets ?? NO_INSETS
  const stacked = isStacked(frame)

  const usable = Math.max(width - insets.left - insets.right, 0)
  const margin = stacked ? STACK_MARGIN : MIN_MARGIN
  const widest = stacked ? frame.width - STACK_MARGIN * 2 : ROW_WIDTH
  const rowWidth = Math.min(widest, Math.max(usable - margin * 2, 0))
  const rowX = insets.left + (usable - rowWidth) / 2
  const navY = height - insets.bottom - NAV_BOTTOM - navHeight
  const contentY = CONTENT_TOP + insets.top
  const content: Box = {
    x: rowX,
    y: contentY,
    width: rowWidth,
    // The way forward sits in the text column, so the content runs to the
    // bottom margin.
    height: Math.max(height - insets.bottom - NAV_BOTTOM - contentY, 0),
  }

  const base = {
    width,
    height,
    stacked,
    rowX,
    rowWidth,
    trailY: TRAIL_TOP + insets.top,
    navY,
    navHeight,
    content,
    answersRow: false,
    answersBelow: false,
    centered: opts.choices === 'below' && screen !== 'picture',
  }
  if (!stacked && screen === 'text') {
    // Nothing shares the row with the text, so it gets more of it.
    const width = Math.min(rowWidth, TEXT_ONLY_WIDTH)
    const x = base.centered ? rowX + (rowWidth - width) / 2 : rowX
    const text = { ...content, x, width }
    return { ...base, text, media: text, answers: text }
  }
  if (!stacked && screen === 'choice' && opts.choices === 'below') {
    // The text on top in a wide column, and the answers under it: side by side
    // when every one can have a column of its own, and stacked when not.
    const textWidth = Math.min(rowWidth, TEXT_ONLY_WIDTH)
    const count = opts.answers?.length ?? 0
    const minHeight = opts.answerMinHeight ?? TILE_SIZE
    const column = (rowWidth - ANSWER_COLUMN_GAP * (count - 1)) / count
    const answersRow = count > 1 && column >= MIN_ANSWER_COLUMN
    const wanted = !opts.answers
      ? content.height * 0.5
      : answersRow
        ? answersRowHeight(opts.answers, column, minHeight, opts.answerSize)
        : answersHeight(opts.answers, textWidth, minHeight, opts.answerSize)
    const room = Math.min(wanted, content.height * STACK_ANSWERS_SHARE)
    const answersWidth = answersRow ? rowWidth : textWidth
    const answers = {
      ...split(content, content.height - room, content.height),
      x: rowX + (rowWidth - answersWidth) / 2,
      width: answersWidth,
    }
    return {
      ...base,
      answersRow,
      answersBelow: true,
      centered: true,
      media: answers,
      answers,
      text: {
        ...split(content, 0, content.height - room - STACK_GAP),
        x: rowX + (rowWidth - textWidth) / 2,
        width: textWidth,
      },
    }
  }
  if (!stacked) {
    const columnWidth = Math.max((rowWidth - COLUMN_GAP) / 2, 0)
    const right = {
      ...content,
      x: rowX + columnWidth + COLUMN_GAP,
      width: columnWidth,
    }
    return {
      ...base,
      text: { ...content, width: columnWidth },
      media: right,
      answers: right,
    }
  }
  if (screen === 'picture') {
    const mediaHeight = content.height * STACK_MEDIA_SHARE
    const media = { ...content, height: mediaHeight }
    return {
      ...base,
      media,
      answers: media,
      text: split(content, mediaHeight + STACK_GAP, content.height),
    }
  }
  if (screen === 'choice') {
    const most = content.height * STACK_ANSWERS_SHARE
    const wanted = opts.answers
      ? answersHeight(
          opts.answers,
          rowWidth,
          opts.answerMinHeight ?? TILE_SIZE,
          opts.answerSize,
        )
      : most
    const height = Math.min(wanted, most)
    const answers = split(content, content.height - height, content.height)
    return {
      ...base,
      answersBelow: true,
      centered: base.centered,
      media: answers,
      answers,
      text: split(content, 0, content.height - height - STACK_GAP),
    }
  }
  return { ...base, text: content, media: content, answers: content }
}

/** The part of `box` from `top` to `bottom`, measured from its top. */
function split(box: Box, top: number, bottom: number): Box {
  return { ...box, y: box.y + top, height: Math.max(bottom - top, 0) }
}

/** The layout of the design frame itself, which is 16:9. */
export const DESIGN_LAYOUT = layoutFor(
  DESIGN_WIDTH,
  DESIGN_HEIGHT,
  { width: DESIGN_WIDTH, height: DESIGN_HEIGHT },
  { screen: 'picture' },
)

/**
 * The height of a tap target designed `height` high, raised so it is never less
 * than {@link MIN_TAP_CSS_PX} on screen. `cssPxInWorld` is the design pixels in
 * one CSS pixel.
 */
export function tapHeight(height: number, cssPxInWorld: number): number {
  return Math.max(height, MIN_TAP_CSS_PX * cssPxInWorld)
}

/**
 * The layout of a `screen` in `region`, with the device's safe area kept clear
 * and the buttons tall enough to tap.
 */
export function layoutIn(
  region: Pick<UiRegion, 'rect' | 'frame' | 'cssPxInWorld'>,
  screen: ScreenKind,
  choice: Pick<LayoutOptions, 'answers' | 'answerSize' | 'choices'> = {},
): ScreenLayout {
  const { rect, cssPxInWorld } = region
  return layoutFor(rect.width, rect.height, region.frame ?? rect, {
    screen,
    navHeight: tapHeight(NAV_HEIGHT, cssPxInWorld),
    insets: scaleInsets(readSafeArea(), cssPxInWorld),
    answerMinHeight: tapHeight(TILE_SIZE, cssPxInWorld),
    ...choice,
  })
}

/** `box` moved from the visible area's corner to the world's origin. */
export function inWorld(box: Box, area: Pick<Rect, 'x' | 'y'>): Box {
  return { ...box, x: box.x + area.x, y: box.y + area.y }
}
