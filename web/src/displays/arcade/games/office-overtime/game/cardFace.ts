// The designed card face, as geometry.
//
// Every figure is the 256x388 reference (`~/Desktop/office/example`) divided by
// the card's own width `w` or height `h` (aspect h/w = 1.5156), so `CardNode`
// and its tests read the same numbers and neither drifts from the art.

import type { Rect } from '@src/stargazer'

/** Card height over width, from the 256x388 reference. */
export const CARD_ASPECT = 388 / 256

/**
 * Below this drawn width a card shows only its cost, badges and name. Kept
 * below the size an org card shrinks to when its window opens to 4 wide during
 * a drag (~133 world-px at 16:9), so placing a card does not blank out the org
 * text; it is only a floor for a genuinely tiny card, where the body text would
 * be noise.
 */
export const DETAIL_MIN_WIDTH = 96

/** Body-text sizes tried largest first, as fractions of the card width. */
export const BODY_SIZE_FRACS = [
  0.078, 0.07, 0.062, 0.055, 0.049, 0.044, 0.04, 0.036,
] as const

export interface Disc {
  cx: number
  cy: number
  r: number
}

export interface CardFaceGeom {
  radius: number
  lanyard: Rect
  artPanel: Rect
  artRadius: number
  floorMark: Rect
  portrait: Disc
  /** The 16x16 portrait pixel square, clipped to the disc at draw time. */
  portraitBox: Rect
  coin: Disc
  coinNumberSize: number
  coinKSize: number
  nameBaselineY: number
  nameCenterX: number
  nameMaxWidth: number
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
  return {
    radius: 0.0898 * w,
    lanyard: {
      x: 0.391 * w,
      y: 0.026 * h,
      width: 0.219 * w,
      height: 0.031 * h,
    },
    artPanel: {
      x: 0.0625 * w,
      y: 0.041 * h,
      width: 0.875 * w,
      height: 0.366 * h,
    },
    artRadius: 0.047 * w,
    floorMark: {
      x: 0.1 * w,
      y: 0.344 * h,
      width: 0.047 * w,
      height: 0.039 * h,
    },
    portrait: { cx: 0.5 * w, cy: 0.327 * h, r: 0.257 * w },
    portraitBox: {
      x: 0.289 * w,
      y: 0.218 * h,
      width: 0.422 * w,
      height: 0.422 * w,
    },
    coin: { cx: 0.164 * w, cy: 0.106 * h, r: 0.0664 * w },
    coinNumberSize: 0.074 * w,
    coinKSize: 0.0375 * w,
    nameBaselineY: 0.59 * h,
    nameCenterX: 0.5 * w,
    nameMaxWidth: 0.78 * w,
    divider: { x0: 0.3125 * w, x1: 0.6875 * w, y: 0.657 * h },
    onHire: {
      x: 0.11 * w,
      y: 0.69 * h,
      width: 0.78 * w,
      height: 0.115 * h,
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
    badgeSize: 0.148 * w,
    badgeX: 0.762 * w,
    badgeFirstY: 0.057 * h,
    badgeStepY: 0.113 * h,
  }
}
