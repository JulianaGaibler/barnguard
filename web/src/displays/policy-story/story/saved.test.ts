import { describe, expect, it } from 'vitest'
import { Run } from './run'
import { SAVED_KEY, clearSavedRun, loadRun, saveRun } from './saved'
import { story } from './story'
import { runAt } from './devJump'

function memory(): Record<string, string> & {
  getItem(k: string): string | null
  setItem(k: string, v: string): void
  removeItem(k: string): void
} {
  const data = new Map<string, string>()
  return {
    getItem: (k: string) => data.get(k) ?? null,
    setItem: (k: string, v: string) => void data.set(k, v),
    removeItem: (k: string) => void data.delete(k),
  } as never
}

describe('a saved run', () => {
  it('comes back as the same place on the same path', () => {
    const storage = memory()
    const run = runAt(story, '2.07')!
    saveRun(run, storage)
    const back = loadRun(story, storage)!
    expect(back.currentId).toBe('2.07')
    expect(back.history).toEqual(run.history)
    expect([...back.flags].sort()).toEqual([...run.flags].sort())
  })

  it('is not kept at the start or at an ending', () => {
    const storage = memory()
    saveRun(runAt(story, '2.07')!, storage)
    saveRun(new Run(story), storage)
    expect(storage.getItem(SAVED_KEY)).toBe(null)
    saveRun(runAt(story, '2.07')!, storage)
    saveRun(runAt(story, '7.01')!, storage)
    expect(storage.getItem(SAVED_KEY)).toBe(null)
  })

  it('is dropped when the path no longer fits the story', () => {
    const storage = memory()
    storage.setItem(
      SAVED_KEY,
      JSON.stringify([{ node: '1.01b' }, { node: '6.14' }]),
    )
    expect(loadRun(story, storage)).toBe(null)
    storage.setItem(SAVED_KEY, 'not json')
    expect(loadRun(story, storage)).toBe(null)
    storage.setItem(SAVED_KEY, JSON.stringify([{ node: 'nowhere' }, {}]))
    expect(loadRun(story, storage)).toBe(null)
  })

  it('can be cleared, and a missing storage changes nothing', () => {
    const storage = memory()
    saveRun(runAt(story, '2.07')!, storage)
    clearSavedRun(storage)
    expect(loadRun(story, storage)).toBe(null)
    expect(() => saveRun(runAt(story, '2.07')!, null)).not.toThrow()
    expect(loadRun(story, null)).toBe(null)
  })
})
