import { describe, expect, it } from 'vitest'
import { illustrationOf, type StoryNode } from './types'

const art = { src: '/a.svg', alt: 'A picture' }

describe('illustrationOf', () => {
  it('is the picture of a screen that has one', () => {
    const node: StoryNode = {
      kind: 'scene',
      body: [],
      illustration: art,
      next: 'x',
    }
    expect(illustrationOf(node)).toBe(art)
    expect(
      illustrationOf({ kind: 'ending', body: [], illustration: art }),
    ).toBe(art)
  })

  it('is null for a screen without one, and for a choice', () => {
    expect(illustrationOf({ kind: 'scene', body: [], next: 'x' })).toBeNull()
    expect(illustrationOf({ kind: 'ending', body: [] })).toBeNull()
    expect(
      illustrationOf({
        kind: 'choice',
        body: [],
        options: [
          { id: 'a', label: 'A', next: 'x' },
          { id: 'b', label: 'B', next: 'x' },
        ],
      }),
    ).toBeNull()
  })
})
