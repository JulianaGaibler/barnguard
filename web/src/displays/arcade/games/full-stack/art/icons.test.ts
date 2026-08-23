import { beforeAll, afterAll, describe, expect, it, vi } from 'vitest'
import { ALL_GROUPS } from '../game/rules/deck'
import { floorMark, groupBadge, iconWidth, icons, loadIcons } from './icons'

describe('loadIcons', () => {
  // Headless has no SVG rasteriser, so every icon takes the blank-canvas
  // fallback and warns. The point under test is that the loader resolves for
  // every icon rather than rejecting, which is what keeps `startGame` from
  // failing on assets.
  let warn: ReturnType<typeof vi.spyOn>
  beforeAll(() => {
    warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
  })
  afterAll(() => warn.mockRestore())

  it(
    'resolves an entry for every icon without throwing',
    { timeout: 15000 },
    async () => {
      const set = await loadIcons()
      for (const group of ALL_GROUPS)
        expect(groupBadge(set, group)).toBeTruthy()
      expect(floorMark(set, 'management')).toBeTruthy()
      expect(floorMark(set, 'ic')).toBeTruthy()
      expect(set.approval).toBeTruthy()
      expect(set.budget).toBeTruthy()
    },
  )

  it(
    'memoises so repeat calls return the same canvases',
    { timeout: 15000 },
    async () => {
      const a = await loadIcons()
      const b = await loadIcons()
      expect(b).toBe(a)
      expect(b.approval).toBe(a.approval)
      expect(icons()).toBe(a)
    },
  )
})

describe('iconWidth', () => {
  it('keeps the icon proportional to its canvas', () => {
    expect(
      iconWidth({ width: 42, height: 26 } as HTMLCanvasElement, 13),
    ).toBeCloseTo(21)
  })
})
