import { describe, expect, it } from 'vitest'
import { runAt } from './devJump'
import { Run } from './run'
import { SAVED_KEY, clearSavedRun, loadRun, saveRun } from './saved'
import { fixtureStory as story } from './fixture'

function memory() {
  const data = new Map<string, string>()
  return {
    getItem: (k: string) => data.get(k) ?? null,
    setItem: (k: string, v: string) => void data.set(k, v),
    removeItem: (k: string) => void data.delete(k),
  }
}

describe('a saved run', () => {
  it('comes back as the same place on the same path', () => {
    const storage = memory()
    const run = runAt(story, 'final-choice')!
    saveRun(run, storage)
    const back = loadRun(story, storage)!
    expect(back.currentId).toBe('final-choice')
    expect(back.history).toEqual(run.history)
    expect([...back.flags].sort()).toEqual([...run.flags].sort())
  })

  it('is not kept at the start or at an ending', () => {
    const storage = memory()
    saveRun(runAt(story, 'final-choice')!, storage)
    saveRun(new Run(story), storage)
    expect(storage.getItem(SAVED_KEY)).toBe(null)
    saveRun(runAt(story, 'final-choice')!, storage)
    saveRun(runAt(story, 'locked-down')!, storage)
    expect(storage.getItem(SAVED_KEY)).toBe(null)
  })

  it('is dropped when the path no longer fits the story', () => {
    const storage = memory()
    storage.setItem(
      SAVED_KEY,
      JSON.stringify([{ node: 'scenario' }, { node: 'locked-down' }]),
    )
    expect(loadRun(story, storage)).toBe(null)
    storage.setItem(SAVED_KEY, 'not json')
    expect(loadRun(story, storage)).toBe(null)
    storage.setItem(SAVED_KEY, JSON.stringify([{ node: 'nowhere' }, {}]))
    expect(loadRun(story, storage)).toBe(null)
  })

  it('can be cleared, and a missing storage changes nothing', () => {
    const storage = memory()
    saveRun(runAt(story, 'final-choice')!, storage)
    clearSavedRun(storage)
    expect(loadRun(story, storage)).toBe(null)
    expect(() => saveRun(runAt(story, 'final-choice')!, null)).not.toThrow()
    expect(loadRun(story, null)).toBe(null)
  })
})
