import { describe, expect, it } from 'vitest'
import { Node2D, SceneTree } from '@src/stargazer'
import {
  BANNER_WIDTH,
  BUTTONS_WIDTH,
  CARD_HEIGHT,
  CARD_WIDTH,
  buildGameOverLayout,
} from './gameOverLayout'

/** The top left of a centre-pivoted child, in the layout's world. */
function topLeft(node: Node2D): { x: number; y: number } {
  return node.localToWorld(0, 0)
}

function laidOut(rect: {
  x: number
  y: number
  width: number
  height: number
}) {
  const layout = buildGameOverLayout(() => rect)
  const scene = new SceneTree(new Node2D('scene-root'))
  scene.root.add(layout.root)
  layout.root._runIfDirty()
  scene.updateTransforms()
  return layout
}

describe('buildGameOverLayout', () => {
  it('places the cards where the design does at 1920 by 1080', () => {
    const layout = laidOut({ x: 0, y: 0, width: 1920, height: 1080 })
    const lefts = layout.cards.map((c) => topLeft(c).x)
    expect(lefts[0]).toBeCloseTo(333.6, 1)
    expect(lefts[1]).toBeCloseTo(764, 1)
    expect(lefts[2]).toBeCloseTo(1194.4, 1)
    expect(topLeft(layout.cards[0]).y).toBeCloseTo(312.5, 1)
  })

  it('places the banner and the buttons where the design does', () => {
    const layout = laidOut({ x: 0, y: 0, width: 1920, height: 1080 })
    const banner = topLeft(layout.banner)
    expect(banner.y).toBeCloseTo(83, 1)
    expect(banner.x + BANNER_WIDTH / 2).toBeCloseTo(960, 1)
    const buttons = topLeft(layout.buttons)
    expect(buttons.y).toBeCloseTo(883, 1)
    expect(buttons.x + BUTTONS_WIDTH / 2).toBeCloseTo(960, 1)
  })

  it('stays centred in a wider region', () => {
    const layout = laidOut({ x: -300, y: 0, width: 2520, height: 1080 })
    const middle = topLeft(layout.cards[1])
    expect(middle.x + CARD_WIDTH / 2).toBeCloseTo(960, 1)
  })

  it('pivots each animated child on its centre', () => {
    const layout = laidOut({ x: 0, y: 0, width: 1920, height: 1080 })
    const card = layout.cards[0]
    card.transform.scaleX = 2
    card.transform.scaleY = 2
    layout.root._runIfDirty()
    // The centre stays put while the corners spread.
    const centre = card.localToWorld(CARD_WIDTH / 2, CARD_HEIGHT / 2)
    expect(centre.x).toBeCloseTo(333.6 + CARD_WIDTH / 2, 1)
    expect(centre.y).toBeCloseTo(312.5 + CARD_HEIGHT / 2, 1)
  })
})
