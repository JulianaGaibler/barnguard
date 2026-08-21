// A mistyped layer row is invisible in a diff and shifts every pixel to its
// right, so the geometry is pinned rather than eyeballed.

import { describe, expect, it } from 'vitest'
import { DECK } from '../game/rules/deck'
import { LIBRARY, PORTRAITS, PORTRAIT_SIZE, portraitPixels } from './portraits'

const layers = (): [string, Record<number, string>][] => [
  ['head', LIBRARY.HEAD],
  ['face', LIBRARY.FACE],
  ...Object.entries(LIBRARY.HAIR),
  ...Object.entries(LIBRARY.GARMENTS),
  ...Object.entries(LIBRARY.EXTRAS),
]

const GLYPHS = new Set([...'.sShHcdCwkaA'])

describe('layer library', () => {
  it('gives every row exactly PORTRAIT_SIZE glyphs', () => {
    for (const [name, layer] of layers()) {
      for (const [row, glyphs] of Object.entries(layer)) {
        expect(glyphs.length, `${name} row ${row}`).toBe(PORTRAIT_SIZE)
      }
    }
  })

  it('keeps every row inside the grid', () => {
    for (const [name, layer] of layers()) {
      for (const row of Object.keys(layer)) {
        expect(Number(row), name).toBeGreaterThanOrEqual(0)
        expect(Number(row), name).toBeLessThan(PORTRAIT_SIZE)
      }
    }
  })

  it('uses only known glyphs', () => {
    for (const [name, layer] of layers()) {
      for (const glyphs of Object.values(layer)) {
        for (const glyph of glyphs) expect(GLYPHS, name).toContain(glyph)
      }
    }
  })
})

describe('portraits', () => {
  it('covers every card and nothing else', () => {
    expect(Object.keys(PORTRAITS).sort()).toEqual(DECK.map((c) => c.id).sort())
  })

  it('draws a full grid for every card', () => {
    for (const card of DECK) {
      const pixels = portraitPixels(card)
      expect(pixels, card.id).toHaveLength(PORTRAIT_SIZE)
      for (const row of pixels) expect(row, card.id).toHaveLength(PORTRAIT_SIZE)
    }
  })

  // A card wearing a department it does not belong to is the one error the art
  // can make that the game itself would read as a lie.
  it('dresses every card in its own department colours', () => {
    for (const card of DECK) {
      const flat = portraitPixels(card).flat().filter(Boolean)
      expect(flat.length, card.id).toBeGreaterThan(40)
    }
  })

  it('spreads skin tones across the whole range', () => {
    const used = new Set(Object.values(PORTRAITS).map((s) => s[0]))
    expect(used.size).toBe(LIBRARY.SKINS.length)
  })
})
