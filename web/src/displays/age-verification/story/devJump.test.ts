import { describe, expect, it } from 'vitest'
import { fixtureStory as story } from './fixture'
import { runAt, runFromQuery } from './devJump'

describe('runAt', () => {
  it('stands on the screen by the shortest path', () => {
    const run = runAt(story, 'second-choice')!
    expect(run.currentId).toBe('second-choice')
    expect(run.history).toHaveLength(3)
  })

  it('takes a path that sets the flags asked for', () => {
    const run = runAt(story, 'final-choice', ['strict'])!
    expect(run.flags.has('strict')).toBe(true)
    expect(run.history.at(-1)).toEqual({ node: 'final-choice' })
  })

  it('finds nothing for flags no path to the screen sets', () => {
    expect(runAt(story, 'first-choice', ['strict'])).toBeNull()
  })
})

describe('runFromQuery', () => {
  it('reads the node and flags', () => {
    const run = runFromQuery(story, '?node=locked-down&flags=strict')!
    expect(run.currentId).toBe('locked-down')
  })

  it('does nothing without a node', () => {
    expect(runFromQuery(story, '?display=age-verification')).toBeNull()
  })
})
