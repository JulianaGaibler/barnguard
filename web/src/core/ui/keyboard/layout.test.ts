import { describe, expect, it } from 'vitest'
import {
  COLUMNS,
  layoutFor,
  typableChars,
  type KeyboardMode,
  type KeyboardPage,
  type KeySpec,
} from './layout'

const MODES: KeyboardMode[] = ['letters', 'name', 'full']
const PAGES: KeyboardPage[] = ['letters', 'symbols']
const OPTIONS = [
  { hasClose: true, hasEnter: true },
  { hasClose: true, hasEnter: false },
  { hasClose: false, hasEnter: true },
  { hasClose: false, hasEnter: false },
]

function keysOf(row: ReturnType<typeof layoutFor>[number]): KeySpec[] {
  return row.filter((item): item is KeySpec => item.kind === 'key')
}

describe('layoutFor', () => {
  it('fills every row to exactly the grid width', () => {
    for (const mode of MODES) {
      for (const page of PAGES) {
        for (const options of OPTIONS) {
          for (const row of layoutFor(mode, page, options)) {
            const total = row.reduce((sum, item) => sum + item.span, 0)
            expect(total, `${mode} ${page} ${JSON.stringify(options)}`).toBe(
              COLUMNS,
            )
          }
        }
      }
    }
  })

  it('never makes a key narrower than a letter', () => {
    for (const mode of MODES) {
      for (const options of OPTIONS) {
        for (const row of layoutFor(mode, 'letters', options)) {
          for (const key of keysOf(row))
            expect(key.span).toBeGreaterThanOrEqual(2)
        }
      }
    }
  })

  it('gives each key an id that is unique within the layout', () => {
    for (const mode of MODES) {
      for (const page of PAGES) {
        const ids = layoutFor(mode, page, OPTIONS[0])
          .flatMap(keysOf)
          .map((key) => key.id)
        expect(new Set(ids).size).toBe(ids.length)
      }
    }
  })

  it('keeps letters mode to three rows with close and enter in the corners', () => {
    const rows = layoutFor('letters', 'letters', OPTIONS[0])
    expect(rows).toHaveLength(3)
    const last = keysOf(rows[2])
    expect(last[0].action.type).toBe('close')
    expect(last[last.length - 1].action.type).toBe('enter')
  })

  it('ignores the page outside full mode', () => {
    for (const mode of ['letters', 'name'] as const) {
      expect(layoutFor(mode, 'symbols', OPTIONS[0])).toEqual(
        layoutFor(mode, 'letters', OPTIONS[0]),
      )
    }
  })

  it('puts close first and enter last in the bottom row of name mode', () => {
    const rows = layoutFor('name', 'letters', OPTIONS[0])
    expect(rows).toHaveLength(4)
    const bottom = keysOf(rows[3])
    expect(bottom.map((key) => key.action.type)).toEqual([
      'close',
      'char',
      'space',
      'char',
      'char',
      'enter',
    ])
    expect(bottom.find((key) => key.action.type === 'space')!.span).toBe(7)
  })

  it('gives the freed columns to space when close and enter are absent', () => {
    const rows = layoutFor('name', 'letters', OPTIONS[3])
    const space = keysOf(rows[3]).find((key) => key.action.type === 'space')
    expect(space!.span).toBe(COLUMNS - 6)
  })

  it('adds a page toggle in full mode and returns from the symbols page', () => {
    const letters = keysOf(layoutFor('full', 'letters', OPTIONS[0])[3])
    expect(letters[1].action).toEqual({ type: 'page', page: 'symbols' })
    const symbols = layoutFor('full', 'symbols', OPTIONS[0])
    expect(symbols).toHaveLength(4)
    expect(keysOf(symbols[3])[1].action).toEqual({
      type: 'page',
      page: 'letters',
    })
    expect(keysOf(symbols[0]).map((key) => key.id)).toContain('char:1')
  })
})

describe('typableChars', () => {
  it('limits letters mode to a to z', () => {
    const chars = typableChars('letters')
    expect(chars.has('a')).toBe(true)
    expect(chars.has('ä')).toBe(false)
    expect(chars.has(' ')).toBe(false)
  })

  it('adds accents and name punctuation in name mode', () => {
    const chars = typableChars('name')
    for (const ch of ['ä', 'ß', 'č', ' ', '-', "'", '.']) {
      expect(chars.has(ch), ch).toBe(true)
    }
    expect(chars.has('1')).toBe(false)
  })

  it('adds digits and symbols in full mode', () => {
    const chars = typableChars('full')
    expect(chars.has('7')).toBe(true)
    expect(chars.has('@')).toBe(true)
  })
})
