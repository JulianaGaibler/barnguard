import { describe, expect, it } from 'vitest'
import { ALL_GROUPS } from '../game/rules/deck'
import { floorMark, groupBadge, icons, loadIcons, viewBoxSize } from './icons'

describe('viewBoxSize', () => {
  it('parses width and height from a viewBox', () => {
    expect(viewBoxSize('<svg viewBox="0 0 40 24">')).toEqual({ w: 40, h: 24 })
  })

  it('falls back to a square when the viewBox is absent', () => {
    expect(viewBoxSize('<svg xmlns="...">')).toEqual({ w: 64, h: 64 })
  })
})

describe('loadIcons', () => {
  // Headless has no SVG rasteriser, so the canvases come back blank; the point
  // is that the loader resolves for every icon rather than rejecting, which is
  // what keeps `startGame` from failing on assets.
  it('resolves an entry for every icon without throwing', async () => {
    const set = await loadIcons()
    for (const group of ALL_GROUPS) expect(groupBadge(set, group)).toBeTruthy()
    expect(floorMark(set, 'management')).toBeTruthy()
    expect(floorMark(set, 'ic')).toBeTruthy()
    expect(set.approval).toBeTruthy()
    expect(set.budget).toBeTruthy()
  })

  it('memoises so repeat calls return the same canvases', async () => {
    const a = await loadIcons()
    const b = await loadIcons()
    expect(b).toBe(a)
    expect(b.approval).toBe(a.approval)
    expect(icons()).toBe(a)
  })
})
