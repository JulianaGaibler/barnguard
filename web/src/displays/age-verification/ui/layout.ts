import type { Rect } from 'stargazer'
import { DESIGN_HEIGHT, DESIGN_WIDTH } from '@src/core/ui/designRegion'
import type { UiRegion } from '@src/core/ui/uiRegion.svelte'
import { isStacked } from './frame'
import { ROW_GAP, TILE_SIZE } from './rowLayout'
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
/** Space between the content and the button row. */
const CONTENT_NAV_GAP = 32
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
/** The share of the column the answers take, under the text. */
const STACK_ANSWERS_SHARE = 0.55

/** The width of an answer's text is its width less the square and the padding. */
const ANSWER_TEXT_INSET = TILE_SIZE + 48
/** An answer's character is this wide and its line this tall, in ems. */
const ANSWER_CHARACTER_EM = 0.53
const ANSWER_LINE_EM = 1.2
/** The height of a capital, in ems, which is what the first line adds. */
const ANSWER_CAP_EM = 0.7
/** What an answer adds to its lines, less 0.35 em, which centers the first line. */
const ANSWER_PADDING = 52
/** The font size of an answer when the caller gives none, in design pixels. */
export const ANSWER_SIZE = 40

/** The least height of a tap target, in CSS pixels. */
export const MIN_TAP_CSS_PX = 48

/** A box, from the top left of the visible area, in design pixels. */
export type Box = Pick<Rect, 'x' | 'y' | 'width' | 'height'>

/** What a screen shows besides its text, which decides how it is split. */
export type ScreenKind = 'choice' | 'picture' | 'text' | 'cards' | 'folders'

/** The share of the content's height that a row of folders takes. */
const FOLDERS_SHARE = 0.62

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
  /**
   * The height the answers need on one column, when they are not a list of
   * rows, such as a row of people. Without it the height follows `answers`.
   */
  answersBlock?: number
  /** The least height of an answer, in design pixels. Default the square's. */
  answerMinHeight?: number
  /** The font size of an answer's text, in design pixels. */
  answerSize?: number
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
  const character = size * ANSWER_CHARACTER_EM
  const room = Math.max(width - ANSWER_TEXT_INSET, character)
  const rows = answers.map((characters) => {
    const lines = Math.max(1, Math.ceil((characters * character) / room))
    const text = size * ((lines - 1) * ANSWER_LINE_EM + ANSWER_CAP_EM)
    return Math.max(minHeight, ANSWER_PADDING - 0.35 * size + text)
  })
  const heights = rows.reduce((sum, height) => sum + height, 0)
  return heights + ROW_GAP * Math.max(rows.length - 1, 0)
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
}

/**
 * Lays the screens out in a visible area of `width` by `height` design pixels,
 * for the frame {@link pickFrame} chose. A frame wider than tall gives two
 * columns: the text on the left, and the picture or the answers on the right. A
 * taller frame gives one column, with the picture above the text, or the
 * answers below it. A screen with only text sets it in a wider column, and one
 * with cards gives them the whole row.
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
  const navHeight = opts.navHeight ?? NAV_HEIGHT
  const insets = opts.insets ?? NO_INSETS
  const stacked = isStacked(frame)
  // On one column a row of folders is a choice with a tall block of answers.
  const requested = opts.screen ?? 'text'
  const screen = stacked && requested === 'folders' ? 'choice' : requested

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
    height: Math.max(navY - CONTENT_NAV_GAP - contentY, 0),
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
  }
  if (!stacked && screen === 'text') {
    // Nothing shares the row with the text, so it gets more of it.
    const text = { ...content, width: Math.min(rowWidth, TEXT_ONLY_WIDTH) }
    return { ...base, text, media: text, answers: text }
  }
  if (!stacked && screen === 'folders') {
    // The text over the whole row, and the folders in the middle under it.
    const folders = content.height * FOLDERS_SHARE
    return {
      ...base,
      text: split(content, 0, content.height - folders - STACK_GAP),
      media: content,
      answers: split(content, content.height - folders, content.height),
    }
  }
  if (!stacked && screen === 'cards') {
    // The cards need the whole row to sit side by side.
    return { ...base, text: content, media: content, answers: content }
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
    const wanted = opts.answersBlock
      ? opts.answersBlock
      : opts.answers
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
  choice: Pick<LayoutOptions, 'answers' | 'answerSize' | 'answersBlock'> = {},
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
