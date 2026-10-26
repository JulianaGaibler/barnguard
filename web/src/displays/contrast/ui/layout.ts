/**
 * Where everything on the screens goes, for one visible area. The numbers are
 * the Figma frame's, which is 1440 by 1080 design pixels. Boxes are measured
 * from the top left of the visible area, which is where the scene's root sits,
 * and extra width becomes margin and more of the neighboring cards.
 *
 * A card has three resting shapes, a keyframe each: at rest between rounds,
 * full screen while it is voted on, and small in the strip after a game. Its
 * text is laid out once, at the full screen size, and scaled to fit the
 * keyframe, so a card in motion is a blend of two keyframes and its text is
 * never relaid out.
 */
import { lerp } from './motion'
import { NO_INSETS, type Insets } from './safeArea'

export interface Size {
  width: number
  height: number
}

export interface Box {
  x: number
  y: number
  width: number
  height: number
}

/** The frame height, which the screens are designed for. */
export const DESIGN_HEIGHT = 1080

/** The width the text of a card is laid out in, at the full screen size. */
export const CONTENT_WIDTH = 1178

/** The card at rest between rounds. */
export const REST_WIDTH = 918
export const REST_HEIGHT = 635
const REST_RADIUS = 46.4
const REST_SCALE = 0.64
/** The scales the card in play zooms between, at rest and at full screen. */
export const ZOOM_SCALES: readonly number[] = [REST_SCALE, 1]
const REST_CONTENT_Y = 94
/** Space between a card at rest and the next. */
const REST_GAP = 108

/** The card in the strip after a game. */
export const STRIP_WIDTH = 367.2
export const STRIP_HEIGHT = 254
const STRIP_RADIUS = 18.56
const STRIP_SCALE = 0.256
const STRIP_CONTENT_Y = 37.6
const STRIP_GAP = 37.8

/** The card full screen. */
const FULL_CONTENT_Y = 222

/** The least space left and right of the banner. */
const BANNER_MARGIN = 128
const BANNER_TOP = 64
export const LOGO_WIDTH = 77
export const LOGO_HEIGHT = 78

/** The row of buttons, the scale and the score share a center line. */
const ROW_FROM_BOTTOM = 110
const ROW_MARGIN = 54
const BUTTON_HEIGHT = 126
const BUTTON_WIDTHS = [174, 174, 242] as const
const BUTTON_GAP = 16
const BUTTON_OUTER_RADIUS = 128
const BUTTON_INNER_RADIUS = 16

export const SCALE_WIDTH = 537
export const SCALE_HEIGHT = 48

export const HUD_DIAMETER = 88
const HUD_GAP = 16

/** The center of the card, so a card at rest sits at the middle. */
export interface CardKey {
  box: Box
  radius: number
  /** Where the text block starts in the card, in screen units. */
  contentX: number
  contentY: number
  /** How much the full screen text is scaled. */
  scale: number
}

/** One of the three parts of the vote buttons and the scale. */
export interface Segment extends Box {
  /** Top left, top right, bottom right, bottom left. */
  radii: [number, number, number, number]
}

export interface Layout {
  width: number
  height: number
  banner: {
    left: number
    right: number
    /** The center line of the text and the logo. */
    centerY: number
    logo: Box
  }
  /** Distance between the centers of two cards at rest. */
  pitch: number
  /** Where the center of a card at rest is. */
  restCenter: { x: number; y: number }
  rowY: number
  buttons: readonly Segment[]
  scale: readonly Segment[]
  hud: {
    score: { x: number; y: number }
    time: { x: number; y: number }
  }
  /** Where the answer's labels sit. */
  labels: {
    result: { x: number; y: number }
  }
  splash: {
    column: { x: number; width: number; centerY: number }
    cards: readonly Box[]
  }
  gameOver: {
    numeral: { x: number; y: number }
    best: { x: number; y: number }
    stripY: number
    stripLeft: number
    stripPitch: number
    buttons: readonly Box[]
  }
}

const SPLASH_CARD_WIDTH = 921
const SPLASH_CARD_HEIGHT = 240
/** How much of each splash card shows on the right, top to bottom. */
const SPLASH_CARD_SHOWN = [414, 506, 594] as const
/** The space between two splash cards, and from the banner to the first. */
const SPLASH_CARD_GAP = 32
const SPLASH_CARD_BELOW_BANNER = 72

function segment(
  x: number,
  y: number,
  width: number,
  height: number,
  radii: [number, number, number, number],
): Segment {
  return { x, y, width, height, radii }
}

/** The layout for a visible area of `size`, keeping `insets` clear. */
export function layoutFor(size: Size, insets: Insets = NO_INSETS): Layout {
  const { width, height } = size
  const centerX = width / 2
  const rowY = height - ROW_FROM_BOTTOM - insets.bottom
  const left = ROW_MARGIN + insets.left
  const right = width - ROW_MARGIN - insets.right

  const outer = Math.min(BUTTON_OUTER_RADIUS, BUTTON_HEIGHT / 2)
  const inner = BUTTON_INNER_RADIUS
  const buttonY = rowY - BUTTON_HEIGHT / 2
  let at = left
  const buttons = BUTTON_WIDTHS.map((w, i) => {
    const radii: [number, number, number, number] =
      i === 0
        ? [outer, inner, inner, outer]
        : i === 2
          ? [inner, outer, outer, inner]
          : [inner, inner, inner, inner]
    const s = segment(at, buttonY, w, BUTTON_HEIGHT, radii)
    at += w + BUTTON_GAP
    return s
  })

  const part = SCALE_WIDTH / 3
  const pill = SCALE_HEIGHT / 2
  const scale = [0, 1, 2].map((i) =>
    segment(
      centerX - SCALE_WIDTH / 2 + part * i,
      rowY - SCALE_HEIGHT / 2,
      part,
      SCALE_HEIGHT,
      i === 0
        ? [pill, 0, 0, pill]
        : i === 2
          ? [0, pill, pill, 0]
          : [0, 0, 0, 0],
    ),
  )

  const timeX = right - HUD_DIAMETER / 2
  const scoreX = timeX - HUD_DIAMETER - HUD_GAP

  const columnX = 105 + insets.left
  const stripPitch = STRIP_WIDTH + STRIP_GAP
  const buttonWidth = (442 - 16) / 2

  return {
    width,
    height,
    banner: {
      left: BANNER_MARGIN + insets.left,
      right: width - BANNER_MARGIN - insets.right,
      centerY: BANNER_TOP + insets.top + LOGO_HEIGHT / 2,
      logo: {
        x: centerX - LOGO_WIDTH / 2,
        y: BANNER_TOP + insets.top,
        width: LOGO_WIDTH,
        height: LOGO_HEIGHT,
      },
    },
    pitch: REST_WIDTH + REST_GAP,
    restCenter: { x: centerX, y: height / 2 },
    rowY,
    buttons,
    scale,
    hud: {
      score: { x: scoreX, y: rowY },
      time: { x: timeX, y: rowY },
    },
    labels: { result: { x: 71 + insets.left, y: rowY } },
    splash: {
      column: {
        x: columnX,
        width: 640,
        centerY: height / 2 + 56.5,
      },
      cards: SPLASH_CARD_SHOWN.map((shown, i) => ({
        x: width - shown - insets.right,
        y:
          BANNER_TOP +
          insets.top +
          LOGO_HEIGHT +
          SPLASH_CARD_BELOW_BANNER +
          i * (SPLASH_CARD_HEIGHT + SPLASH_CARD_GAP),
        width: SPLASH_CARD_WIDTH,
        height: SPLASH_CARD_HEIGHT,
      })),
    },
    gameOver: {
      numeral: { x: centerX - 13, y: height / 2 - 218.8 },
      best: { x: centerX + 124, y: height / 2 - 127.5 },
      stripY: height / 2,
      stripLeft: BANNER_MARGIN + insets.left,
      stripPitch,
      buttons: [0, 1].map((i) => ({
        x: centerX - 221 + i * (buttonWidth + 16),
        y: height - 123 - insets.bottom,
        width: buttonWidth,
        height: 100,
      })),
    },
  }
}

/** The card at rest, centered on `centerX`. */
export function restKey(layout: Layout, centerX: number): CardKey {
  return {
    box: {
      x: centerX - REST_WIDTH / 2,
      y: layout.restCenter.y - REST_HEIGHT / 2,
      width: REST_WIDTH,
      height: REST_HEIGHT,
    },
    radius: REST_RADIUS,
    contentX: (REST_WIDTH - CONTENT_WIDTH * REST_SCALE) / 2,
    contentY: REST_CONTENT_Y,
    scale: REST_SCALE,
  }
}

/** The card filling the visible area. */
export function fullKey(layout: Layout): CardKey {
  return {
    box: { x: 0, y: 0, width: layout.width, height: layout.height },
    radius: 0,
    contentX: (layout.width - CONTENT_WIDTH) / 2,
    contentY: FULL_CONTENT_Y,
    scale: 1,
  }
}

/** The `index`th card of the strip, from `scroll` design pixels along it. */
export function stripKey(
  layout: Layout,
  index: number,
  scroll: number,
): CardKey {
  const { stripLeft, stripPitch, stripY } = layout.gameOver
  return {
    box: {
      x: stripLeft + index * stripPitch - scroll,
      y: stripY,
      width: STRIP_WIDTH,
      height: STRIP_HEIGHT,
    },
    radius: STRIP_RADIUS,
    contentX: (STRIP_WIDTH - CONTENT_WIDTH * STRIP_SCALE) / 2,
    contentY: STRIP_CONTENT_Y,
    scale: STRIP_SCALE,
  }
}

/** The blend of two keyframes, `t` of the way from `a` to `b`. */
export function blendKey(a: CardKey, b: CardKey, t: number): CardKey {
  return {
    box: {
      x: lerp(a.box.x, b.box.x, t),
      y: lerp(a.box.y, b.box.y, t),
      width: lerp(a.box.width, b.box.width, t),
      height: lerp(a.box.height, b.box.height, t),
    },
    radius: lerp(a.radius, b.radius, t),
    contentX: lerp(a.contentX, b.contentX, t),
    contentY: lerp(a.contentY, b.contentY, t),
    scale: lerp(a.scale, b.scale, t),
  }
}

/**
 * The widest the strip scrolls: how far the last card can be pulled to the
 * edge.
 */
export function maxStripScroll(layout: Layout, cards: number): number {
  const { stripLeft, stripPitch } = layout.gameOver
  const content = stripLeft + (cards - 1) * stripPitch + STRIP_WIDTH
  return Math.max(content + stripLeft - layout.width, 0)
}

/** The buttons turning into the scale, `t` of the way, 0 to 1. */
export function segmentsAt(layout: Layout, t: number): Segment[] {
  return layout.buttons.map((from, i) => {
    const to = layout.scale[i]!
    return {
      x: lerp(from.x, to.x, t),
      y: lerp(from.y, to.y, t),
      width: lerp(from.width, to.width, t),
      height: lerp(from.height, to.height, t),
      radii: from.radii.map((r, k) =>
        lerp(r, to.radii[k]!, t),
      ) as Segment['radii'],
    }
  })
}

/** The center of the box, for placing things in it. */
export function centerOf(box: Box): { x: number; y: number } {
  return { x: box.x + box.width / 2, y: box.y + box.height / 2 }
}
