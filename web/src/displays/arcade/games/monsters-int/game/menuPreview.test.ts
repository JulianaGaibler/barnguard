import { describe, expect, it } from 'vitest'
import raw from '../assets/menu-mouth.svg?raw'
import { MENU_MOUTH } from './art/menuArt'
import { swallow } from './menuPreview'
import { buildDeck, faceOf } from './rules/cards'

// The menu drops cards down the monster's throat, and where the throat is comes
// from constants rather than from the drawing. Re-export the art with the mouth
// anywhere else and the cards land on the floor beside it, which nothing else
// would catch.

/** The opening, read back out of the artwork it was measured from. */
function mouthFromArt(): {
  cx: number
  cy: number
  rx: number
  ry: number
  width: number
  height: number
} {
  const size = /width="(\d+)" height="(\d+)"/.exec(raw)
  const el =
    /<ellipse cx="([\d.]+)" cy="([\d.]+)"[^>]*rx="([\d.]+)" ry="([\d.]+)"/.exec(
      raw,
    )
  expect(size, 'artwork has width and height').not.toBeNull()
  expect(el, 'artwork opens with the mouth ellipse').not.toBeNull()
  return {
    cx: Number(el![1]),
    cy: Number(el![2]),
    rx: Number(el![3]),
    ry: Number(el![4]),
    width: Number(size![1]),
    height: Number(size![2]),
  }
}

describe('MENU_MOUTH', () => {
  it('matches the opening in the artwork', () => {
    const art = mouthFromArt()
    expect(MENU_MOUTH.centerXFrac).toBeCloseTo(art.cx / art.width, 6)
    expect(MENU_MOUTH.centerYFrac).toBeCloseTo(art.cy / art.height, 6)
    expect(MENU_MOUTH.halfWidthFrac).toBeCloseTo(art.rx / art.width, 6)
    expect(MENU_MOUTH.halfHeightFrac).toBeCloseTo(art.ry / art.height, 6)
  })

  it('leaves the opening inside the picture', () => {
    expect(MENU_MOUTH.centerXFrac - MENU_MOUTH.halfWidthFrac).toBeGreaterThan(0)
    expect(MENU_MOUTH.centerXFrac + MENU_MOUTH.halfWidthFrac).toBeLessThan(1)
    // The far side of the opening runs off the foot of the picture on purpose,
    // which is what makes it a hole rather than an ellipse lying on a surface.
    expect(MENU_MOUTH.centerYFrac + MENU_MOUTH.halfHeightFrac).toBeGreaterThan(
      1,
    )
    expect(MENU_MOUTH.centerYFrac - MENU_MOUTH.halfHeightFrac).toBeGreaterThan(
      0,
    )
  })
})

// A card that stops falling while it is still over the lip blinks out in
// mid-air. Nothing about the three constants that decide this is obvious from
// reading any one of them, and the outermost column is the one that fails
// first, because the lip of an ellipse is highest at its corners.
describe('swallowing a card', () => {
  it('has the whole card under the lip before it wraps', () => {
    const s = swallow()
    expect(s.top).toBeGreaterThan(s.outerRim)
  })

  it('keeps it inside the picture rather than out the bottom', () => {
    expect(swallow().bottom).toBeLessThanOrEqual(1)
  })

  it('lands it inside the opening rather than short of it', () => {
    const s = swallow()
    expect(s.center).toBeGreaterThan(
      MENU_MOUTH.centerYFrac - MENU_MOUTH.halfHeightFrac,
    )
    expect(s.center).toBeLessThan(MENU_MOUTH.centerYFrac)
  })
})

describe('the faces the menu can draw', () => {
  // The stream is weighted by drawing from the real deck. If that stops being
  // true the menu turns into a uniform shuffle of all 23 faces, which reads as
  // an action card every third card.
  it('is weighted the way the deck is', () => {
    const faces = buildDeck().map((c) => faceOf(c.card))
    const count = (id: string): number => faces.filter((f) => f === id).length
    expect(count('card-12')).toBe(12)
    expect(count('card-01')).toBe(1)
    expect(count('card-00')).toBe(1)
    expect(count('action-freeze')).toBe(3)
    // A number is far more likely to fall than an action card.
    const numbers = faces.filter((f) => f.startsWith('card-')).length
    expect(numbers / faces.length).toBeGreaterThan(0.8)
  })
})
