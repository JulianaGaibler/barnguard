import { describe, expect, it } from 'vitest'
import { MENU_WALL } from '../tuning'
import { MenuBackdropNode } from './MenuBackdropNode'

const view = { x: 0, y: 0, width: 1600, height: 900 }

describe('MenuBackdropNode', () => {
  it('leaves the menu rail alone', () => {
    const node = new MenuBackdropNode('wall')
    node.setRect(view)
    const list = node.cells
    expect(list.length).toBeGreaterThan(8)
    for (const c of list) {
      expect(c.x).toBeGreaterThanOrEqual(view.width * MENU_WALL.railShare)
      expect(c.x).toBeLessThan(view.x + view.width)
    }
  })

  it('drops its cells when the view has no area', () => {
    const node = new MenuBackdropNode('wall')
    node.setRect(view)
    node.setRect({ x: 0, y: 0, width: 0, height: 0 })
    expect(node.cells).toHaveLength(0)
  })

  it('opens with some of the wall already filled', () => {
    const node = new MenuBackdropNode('wall')
    node.setRect(view)
    const up = node.cells.filter((c) => c.alpha === 1)
    expect(up.length).toBeGreaterThan(0)
    expect(up.length).toBeLessThan(node.cells.length)
  })

  it('leaves every cell settled at one end or the other', () => {
    const node = new MenuBackdropNode('wall')
    node.setRect(view)
    for (const c of node.cells) expect(c.alpha).toBe(c.target)
  })

  it('rests for longer than a swap takes', () => {
    expect(MENU_WALL.rest).toBeGreaterThan(MENU_WALL.stagger)
  })
})
