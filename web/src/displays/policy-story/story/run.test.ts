import { describe, expect, it } from 'vitest'
import { fill, holds, resolveNext, Run, valuesOf, visibleText } from './run'
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

describe('text with parts and values', () => {
  const flags = new Set(['dinner=late', 'name=June'])

  it('joins the parts that hold into one paragraph', () => {
    const body = [
      'Always.',
      [
        'You pull in at 7:55.',
        { when: { flag: 'dinner=late' }, text: 'It is later than that.' },
        { when: { flag: 'dinner=home' }, text: 'Right on time.' },
      ],
    ]
    expect(visibleText(body, flags)).toEqual([
      'Always.',
      'You pull in at 7:55. It is later than that.',
    ])
  })

  it('drops a paragraph made of parts when none holds', () => {
    const body = [[{ when: { flag: 'nope' }, text: 'Never.' }]]
    expect(visibleText(body, flags)).toEqual([])
  })

  it('reads a remembered choice written key=value', () => {
    expect(valuesOf(flags).get('name')).toBe('June')
    expect(fill('Call her {name}.', valuesOf(flags))).toBe('Call her June.')
    expect(visibleText(['About {name}.'], flags)).toEqual(['About June.'])
  })

  it('lets the last choice of a key win and leaves an unknown key alone', () => {
    const values = valuesOf(new Set(['name=Ada', 'name=June']))
    expect(values.get('name')).toBe('June')
    expect(fill('{who}', values)).toBe('{who}')
  })
})

const talk = defineStory({
  start: 'opening',
  nodes: {
    opening: {
      kind: 'scene',
      label: 'June.',
      mood: 'home',
      body: ['Start.'],
      button: 'Go inside',
      sets: ['inside'],
      next: 'ask',
    },
    ask: {
      kind: 'choice',
      body: ['Say something.'],
      prompt: 'Choose.',
      options: [
        {
          id: 'hello',
          label: 'Hello.',
          sets: ['name=June'],
          reply: [
            'She nods.',
            { when: { flag: 'inside' }, text: 'You are in the house.' },
            'Her name is {name}.',
          ],
          next: 'after',
        },
        { id: 'bye', label: 'Bye.', next: 'after' },
      ],
    },
    after: {
      kind: 'scene',
      mood: 'night',
      dropsTrail: true,
      body: ['Later.'],
      next: 'end',
    },
    end: { kind: 'ending', body: ['Done.'] },
  },
})

describe('Run with replies, moods and a button that sets flags', () => {
  it('shows the reply of the answer that led here, with flags and values', () => {
    const run = new Run(talk).continue().choose('hello')
    expect(run.reply()).toEqual([
      'She nods.',
      'You are in the house.',
      'Her name is June.',
    ])
  })

  it('has no reply after an answer without one, or on a screen reached by a button', () => {
    expect(new Run(talk).continue().choose('bye').reply()).toEqual([])
    expect(new Run(talk).reply()).toEqual([])
    expect(new Run(talk).continue().choose('hello').continue().reply()).toEqual(
      [],
    )
  })

  it('sets the flags of a button once it is pressed', () => {
    const run = new Run(talk)
    expect(run.flags.has('inside')).toBe(false)
    expect(run.continue().flags.has('inside')).toBe(true)
  })

  it('takes the mood of the last screen that names one', () => {
    const ask = new Run(talk).continue()
    expect(new Run(talk).mood).toBe('home')
    expect(ask.mood).toBe('home')
    expect(ask.choose('bye').mood).toBe('night')
  })

  it('drops the progress row for good once a screen says so', () => {
    const ask = new Run(talk).continue()
    expect(ask.trailDropped).toBe(false)
    expect(ask.progress()).toHaveLength(1)
    const after = ask.choose('bye')
    expect(after.trailDropped).toBe(true)
    expect(after.progress()).toEqual([])
    expect(after.continue().progress()).toEqual([])
  })
})
