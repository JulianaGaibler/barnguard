// The designed card face, as geometry.
//
// Every figure is the 256x388 reference card art divided by the card's own
// width `w` or height `h` (aspect h/w = 1.5156), so `CardNode` and its tests
// read the same numbers and neither drifts from the art.
//
// The upper half sits tighter than the reference draws it. Rules text in
// symbols still runs to two lines on the busier cards, and the art, the coin
// and the name all read fine a little smaller, so the space comes from them and
// goes to the on-hire band.

import type { Rect } from '@src/stargazer'

/**
 * Below this drawn width a card shows only its cost, badges and name. Kept
 * below the size an org card shrinks to when its window opens to 4 wide during
 * a drag (~133 world-px at 16:9), so placing a card does not blank out the org
 * text. It is only a floor for a genuinely tiny card, where the body text would
 * be noise.
 */
export const DETAIL_MIN_WIDTH = 96

/** Body-text sizes tried largest first, as fractions of the card width. */
export const BODY_SIZE_FRACS = [
  0.078, 0.07, 0.062, 0.055, 0.049, 0.044, 0.04, 0.036,
] as const

/**
 * Name sizes tried largest first, as fractions of the card width.
 *
 * Smaller than the reference art sets them. A name is one or two short lines
 * and reads at a glance, while the rules underneath are the part a player has
 * to work through, so the name gives up its slack first.
 */
export const NAME_SIZE_FRACS = [0.082, 0.074, 0.066, 0.059, 0.053] as const

export interface Disc {
  cx: number
  cy: number
  r: number
}

export interface CardFaceGeom {
  /** One reference-art unit in card space, so `256 * unit === w`. */
  unit: number
  radius: number
  lanyard: Rect
  artPanel: Rect
  artRadius: number
  floorMark: Rect
  portrait: Disc
  /** The 16x16 portrait pixel square, clipped to the disc at draw time. */
  portraitBox: Rect
  /** Where the elevator sits on a card that moves the floor marker. */
  elevator: Rect
  coin: Disc
  coinNumberSize: number
  coinKSize: number
  /**
   * The name's box, from below the portrait disc down to the divider. Two lines
   * fit, which the longer job titles need: "Culture & Engagement Manager" is
   * unreadable cut to one.
   */
  nameBox: Rect
  divider: { x0: number; x1: number; y: number }
  onHire: Rect
  reviewBand: Rect
  reviewRadius: number
  pointsChip: Rect
  reviewText: Rect
  badgeSize: number
  badgeX: number
  badgeFirstY: number
  badgeStepY: number
  /** The face-down card's reward row: two approvals, "+", "6k", a budget note. */
  openSeatRow: { centerY: number; approvalHeight: number; budgetHeight: number }
}

/** Resolve every part of the face for a card drawn at `w` x `h`. */
export function cardFace(w: number, h: number): CardFaceGeom {
  const reviewBand: Rect = {
    x: 0.07 * w,
    y: 0.825 * h,
    width: 0.859 * w,
    height: 0.129 * h,
  }
  const pointsChip: Rect = {
    x: reviewBand.x,
    y: reviewBand.y,
    width: 0.137 * w,
    height: reviewBand.height,
  }
  const reviewTextX = pointsChip.x + pointsChip.width + 0.025 * w
  const coin: Disc = { cx: 0.164 * w, cy: 0.095 * h, r: 0.0664 * w }
  return {
    unit: w / 256,
    radius: 0.0898 * w,
    lanyard: {
      x: 0.391 * w,
      y: 0.022 * h,
      width: 0.219 * w,
      height: 0.031 * h,
    },
    artPanel: {
      x: 0.0625 * w,
      y: 0.034 * h,
      width: 0.875 * w,
      height: 0.345 * h,
    },
    artRadius: 0.047 * w,
    floorMark: {
      x: (24 / 256) * w,
      y: 0.3095 * h,
      width: (17 / 256) * w,
      height: (20 / 388) * h,
    },
    portrait: { cx: 0.5 * w, cy: 0.303 * h, r: 0.242 * w },
    portraitBox: {
      x: 0.301 * w,
      y: 0.2 * h,
      width: 0.398 * w,
      height: 0.398 * w,
    },
    // Between the lanyard slot and the top of the portrait disc, on the line
    // the coin and the badges already hang from.
    elevator: {
      x: 0.5 * w - 0.0525 * w,
      y: coin.cy - 0.0525 * w,
      width: 0.105 * w,
      height: 0.105 * w,
    },
    coin,
    coinNumberSize: 0.074 * w,
    coinKSize: 0.0375 * w,
    nameBox: {
      x: 0.11 * w,
      y: 0.47 * h,
      width: 0.78 * w,
      height: 0.125 * h,
    },
    divider: { x0: 0.3125 * w, x1: 0.6875 * w, y: 0.612 * h },
    onHire: {
      x: 0.11 * w,
      y: 0.645 * h,
      width: 0.78 * w,
      height: 0.16 * h,
    },
    reviewBand,
    reviewRadius: 0.031 * w,
    pointsChip,
    reviewText: {
      x: reviewTextX,
      y: reviewBand.y,
      width: reviewBand.x + reviewBand.width - reviewTextX - 0.02 * w,
      height: reviewBand.height,
    },
    badgeSize: (40 / 256) * w,
    badgeX: (194 / 256) * w,
    // The badges read as a set with the coin opposite them, so they hang from
    // the same line rather than from a figure of their own.
    badgeFirstY: coin.cy - coin.r,
    badgeStepY: (44 / 388) * h,
    openSeatRow: {
      centerY: (292 / 388) * h,
      approvalHeight: (40 / 388) * h,
      budgetHeight: (26 / 388) * h,
    },
  }
}
