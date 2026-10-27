import { describe, expect, it } from 'vitest'
import { blocks, plain, segments } from './emphasis'

describe('segments', () => {
  it('leaves unmarked text as one run', () => {
    expect(segments('No marks.')).toEqual([
      { text: 'No marks.', strong: false },
    ])
  })

  it('splits at a pair of marks', () => {
    expect(segments('Use **age assurance** online.')).toEqual([
      { text: 'Use ', strong: false },
      { text: 'age assurance', strong: true },
      { text: ' online.', strong: false },
    ])
  })

  it('reads several pairs', () => {
    expect(segments('**A** and **B**').map((s) => s.strong)).toEqual([
      true,
      false,
      true,
    ])
  })

  it('keeps a mark with no partner as text', () => {
    expect(segments('One ** only')).toEqual([
      { text: 'One ** only', strong: false },
    ])
    expect(plain('**A** then ** B')).toBe('A then ** B')
  })

  it('has no empty runs', () => {
    expect(segments('****')).toEqual([])
    expect(segments('**A**')).toEqual([{ text: 'A', strong: true }])
  })
})

describe('plain', () => {
  it('takes the marks out', () => {
    expect(plain('Use **age assurance** online.')).toBe(
      'Use age assurance online.',
    )
  })
})

describe('blocks', () => {
  it('keeps paragraphs as they are', () => {
    expect(blocks(['One.', 'Two.'])).toEqual([
      { kind: 'paragraph', text: 'One.' },
      { kind: 'paragraph', text: 'Two.' },
    ])
  })

  it('joins following items into one list, without their dashes', () => {
    expect(blocks(['It requires:', '- A', '- B', 'Then more.'])).toEqual([
      { kind: 'paragraph', text: 'It requires:' },
      { kind: 'list', items: ['A', 'B'] },
      { kind: 'paragraph', text: 'Then more.' },
    ])
  })

  it('starts a new list after a paragraph', () => {
    expect(blocks(['- A', 'Between.', '- B']).map((b) => b.kind)).toEqual([
      'list',
      'paragraph',
      'list',
    ])
  })
})
