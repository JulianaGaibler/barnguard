import { describe, expect, it } from 'vitest'
import { CardNode } from './CardNode'
import { cardFace } from '../cardFace'
import { DECK } from '../rules/deck'

describe('cardFace geometry', () => {
  const g = cardFace(256, 388)

  it('matches the reference fractions of a 256x388 card', () => {
    expect(g.radius).toBeCloseTo(0.0898 * 256, 3)
    expect(g.portrait.cx).toBeCloseTo(128, 3)
    expect(g.portrait.cy).toBeCloseTo(0.327 * 388, 3)
    expect(g.portrait.r).toBeCloseTo(0.257 * 256, 3)
    expect(g.coin.cx).toBeCloseTo(0.164 * 256, 3)
    expect(g.coin.r).toBeCloseTo(0.0664 * 256, 3)
  })

  it('keeps the portrait pixel box square', () => {
    expect(g.portraitBox.width).toBeCloseTo(g.portraitBox.height, 6)
  })

  it('puts the review text right of the points chip, inside the band', () => {
    expect(g.pointsChip.x).toBe(g.reviewBand.x)
    expect(g.reviewText.x).toBeGreaterThan(g.pointsChip.x + g.pointsChip.width)
    expect(g.reviewText.x + g.reviewText.width).toBeLessThanOrEqual(
      g.reviewBand.x + g.reviewBand.width + 1e-6,
    )
  })

  it('scales linearly with the card', () => {
    const a = cardFace(200, 300)
    const b = cardFace(400, 600)
    expect(b.coin.cx).toBeCloseTo(a.coin.cx * 2, 6)
    expect(b.reviewBand.width).toBeCloseTo(a.reviewBand.width * 2, 6)
  })
})

describe('CardNode', () => {
  it('holds the face it is given', () => {
    const node = new CardNode('t')
    const card = DECK[0]!
    node.setFace({ kind: 'card', card, budget: 0 })
    expect(node.face).toEqual({ kind: 'card', card, budget: 0 })
  })

  it('sizes itself and bounds a shadow bleed', () => {
    const node = new CardNode('t')
    node.setSize(200, 303)
    expect(node.width).toBe(200)
    expect(node.height).toBe(303)
    expect(node.debugBounds!.x).toBeLessThan(0)
    expect(node.debugBounds!.width).toBeGreaterThan(200)
  })

  it('hit-tests the card rect', () => {
    const node = new CardNode('t')
    node.setFace({ kind: 'openSeat' })
    node.setSize(200, 303)
    expect(node.hitTest(100, 150, 0)).toBe(true)
    expect(node.hitTest(-5, 10, 0)).toBe(false)
    expect(node.hitTest(210, 10, 0)).toBe(false)
  })
})
