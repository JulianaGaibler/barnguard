import { describe, expect, it } from 'vitest'
import { holds, resolveNext, Run, visibleText } from './run'
import { defineStory } from './types'

const story = defineStory({
  start: 'intro',
  nodes: {
    intro: { kind: 'scene', body: ['Hello.'], next: 'ask' },
    ask: {
      kind: 'choice',
      body: ['Pick one.', { when: { flag: 'x' }, text: 'Never at first.' }],
      options: [
        { id: 'a', label: 'A', sets: ['x'], next: 'event' },
        { id: 'b', label: 'B', next: 'end' },
      ],
    },
    event: {
      kind: 'moment',
      body: ['Something happened.'],
      next: [{ when: { flag: 'x' }, to: 'end' }, { to: 'intro' }],
    },
    end: {
      kind: 'ending',
      body: ['Done.', { when: { not: { flag: 'x' } }, text: 'Without x.' }],
    },
  },
})

describe('conditions', () => {
  const flags = new Set(['a', 'b'])

  it('reads flags, not, all, and any', () => {
    expect(holds({ flag: 'a' }, flags)).toBe(true)
    expect(holds({ not: { flag: 'a' } }, flags)).toBe(false)
    expect(holds({ all: [{ flag: 'a' }, { flag: 'c' }] }, flags)).toBe(false)
    expect(holds({ any: [{ flag: 'c' }, { flag: 'b' }] }, flags)).toBe(true)
  })

  it('picks the first route that matches', () => {
    const next = [
      { when: { flag: 'c' }, to: 'one' },
      { when: { flag: 'a' }, to: 'two' },
      { to: 'three' },
    ]
    expect(resolveNext(next, flags)).toBe('two')
    expect(resolveNext(next, new Set())).toBe('three')
    expect(resolveNext('plain', flags)).toBe('plain')
  })

  it('shows conditional paragraphs only when they hold', () => {
    const body = ['always', { when: { flag: 'c' }, text: 'never' }]
    expect(visibleText(body, flags)).toEqual(['always'])
  })
})

describe('Run', () => {
  it('starts at the start', () => {
    const run = new Run(story)
    expect(run.currentId).toBe('intro')
    expect(run.atStart).toBe(true)
    expect(run.atEnd).toBe(false)
  })

  it('records answers and sets their flags', () => {
    const run = new Run(story).continue().choose('a')
    expect(run.currentId).toBe('event')
    expect(run.history).toEqual([
      { node: 'intro' },
      { node: 'ask', option: 'a' },
      { node: 'event' },
    ])
    expect([...run.flags]).toEqual(['x'])
  })

  it('routes on the flags the path set', () => {
    expect(new Run(story).continue().choose('a').continue().currentId).toBe(
      'end',
    )
  })

  it('unwinds an answer and its flags on back', () => {
    const run = new Run(story).continue().choose('a').back()
    expect(run.currentId).toBe('ask')
    expect(run.history.at(-1)).toEqual({ node: 'ask' })
    expect(run.flags.size).toBe(0)
    expect(run.text()).toEqual(['Pick one.'])
  })

  it('stays put on back from the first screen', () => {
    const run = new Run(story)
    expect(run.back()).toBe(run)
  })

  it('never changes the run it was called on', () => {
    const start = new Run(story)
    start.continue().choose('b')
    expect(start.currentId).toBe('intro')
    expect(start.history).toHaveLength(1)
  })

  it('shows paragraphs for the flags so far', () => {
    expect(new Run(story).continue().choose('b').text()).toEqual([
      'Done.',
      'Without x.',
    ])
  })

  it('reaches an ending', () => {
    expect(new Run(story).continue().choose('b').atEnd).toBe(true)
  })

  it('marks each screen after the opening one, with moments as their own kind', () => {
    const run = new Run(story).continue().choose('a')
    expect(new Run(story).progress()).toEqual([])
    expect(run.progress()).toEqual([
      { kind: 'step', current: false },
      { kind: 'moment', current: true },
    ])
  })

  it('refuses moves the current screen does not offer', () => {
    const run = new Run(story)
    expect(() => run.choose('a')).toThrow('not a choice')
    expect(() => run.continue().choose('z')).toThrow('no option')
    expect(() => run.continue().continue()).toThrow('no Continue')
  })

  it('refuses a history through a missing node', () => {
    expect(() => new Run(story, [{ node: 'gone' }])).toThrow('no node')
  })
})
