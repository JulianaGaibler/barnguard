import { describe, expect, it } from 'vitest'
import { enumeratePaths, findCycle, validateStory } from './validate'
import type { Story, StoryNode } from './types'

/** A story whose nodes a test can replace. */
interface Draft extends Story {
  nodes: Record<string, StoryNode>
}

/** A valid story to break one rule at a time. */
function base(): Draft {
  return {
    start: 'intro',
    nodes: {
      intro: { kind: 'scene', body: ['Hi.'], next: 'ask' },
      ask: {
        kind: 'choice',
        body: ['Pick.'],
        options: [
          { id: 'a', label: 'A', sets: ['a'], next: 'end' },
          { id: 'b', label: 'B', next: 'end' },
        ],
      },
      end: {
        kind: 'ending',
        body: ['Bye.', { when: { flag: 'a' }, text: 'With a.' }],
      },
    },
  }
}

function errorsOf(story: Story): string[] {
  return validateStory(story).errors
}

describe('validateStory', () => {
  it('passes a valid story', () => {
    expect(validateStory(base())).toEqual({ errors: [], warnings: [] })
  })

  it('reports a missing start', () => {
    expect(errorsOf({ ...base(), start: 'nope' })).toEqual([
      'the start "nope" is not a node',
    ])
  })

  it('reports a link to a missing node', () => {
    const story = base()
    story.nodes.intro = { kind: 'scene', body: [], next: 'gone' }
    expect(errorsOf(story)).toContain(
      '"intro" leads to "gone", which is not a node',
    )
  })

  it('reports a loop with its path', () => {
    const story = base()
    story.nodes.ask = {
      kind: 'choice',
      body: [],
      options: [
        { id: 'a', label: 'A', sets: ['a'], next: 'intro' },
        { id: 'b', label: 'B', next: 'end' },
      ],
    }
    expect(errorsOf(story)).toContain('the story loops: intro → ask → intro')
    expect(findCycle(base())).toBeNull()
  })

  it('reports a node nothing leads to', () => {
    const story = base()
    story.nodes.stray = { kind: 'ending', body: [] }
    expect(errorsOf(story)).toEqual(['nothing leads to "stray"'])
  })

  it('reports a route list that can match nothing', () => {
    const story = base()
    story.nodes.intro = {
      kind: 'scene',
      body: [],
      next: [{ when: { flag: 'a' }, to: 'ask' }],
    }
    expect(errorsOf(story)).toContain(
      '"intro" can match no route, its last route needs no "when"',
    )
  })

  it('reports routes after one that always matches', () => {
    const story = base()
    story.nodes.intro = {
      kind: 'scene',
      body: [],
      next: [{ to: 'ask' }, { to: 'end' }],
    }
    expect(errorsOf(story)).toContain(
      '"intro" has routes after one that always matches',
    )
  })

  it('reports an empty route list', () => {
    const story = base()
    story.nodes.intro = { kind: 'scene', body: [], next: [] }
    expect(errorsOf(story)).toContain('"intro" leads nowhere')
  })

  it('reports a flag read but never set', () => {
    const story = base()
    story.nodes.end = {
      kind: 'ending',
      body: [
        { when: { all: [{ flag: 'a' }, { not: { flag: 'z' } }] }, text: '' },
      ],
    }
    expect(errorsOf(story)).toEqual(['the flag "z" is read but never set'])
  })

  it('warns about a flag set but never read', () => {
    const story = base()
    story.nodes.end = { kind: 'ending', body: [] }
    expect(validateStory(story)).toEqual({
      errors: [],
      warnings: ['the flag "a" is set but never read'],
    })
  })

  it('reports option counts and duplicate ids', () => {
    const story = base()
    story.nodes.ask = {
      kind: 'choice',
      body: [],
      options: [{ id: 'a', label: 'A', sets: ['a'], next: 'end' }],
    }
    expect(errorsOf(story)).toEqual(['"ask" has 1 options, it needs 2 to 4'])
    story.nodes.ask = {
      kind: 'choice',
      body: [],
      options: [
        { id: 'a', label: 'A', sets: ['a'], next: 'end' },
        { id: 'a', label: 'B', next: 'end' },
      ],
    }
    expect(errorsOf(story)).toEqual(['"ask" has two options with the id "a"'])
  })
})

describe('enumeratePaths', () => {
  it('follows every answer to an ending', () => {
    expect(enumeratePaths(base())).toEqual([
      [{ node: 'intro' }, { node: 'ask', option: 'a' }, { node: 'end' }],
      [{ node: 'intro' }, { node: 'ask', option: 'b' }, { node: 'end' }],
    ])
  })

  it('stops at the limit', () => {
    expect(enumeratePaths(base(), 1)).toHaveLength(1)
  })
})
