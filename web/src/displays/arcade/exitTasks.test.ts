import { afterEach, describe, expect, it, vi } from 'vitest'
import { registerExitTask, runExitTasks } from './exitTasks'

const unregisters: Array<() => void> = []

function register(run: () => Promise<void> | void): void {
  unregisters.push(registerExitTask(run))
}

afterEach(() => {
  for (const off of unregisters.splice(0)) off()
  vi.useRealTimers()
})

describe('runExitTasks', () => {
  it('runs every registered task', async () => {
    const ran: string[] = []
    register(() => {
      ran.push('sync')
    })
    register(async () => {
      await Promise.resolve()
      ran.push('async')
    })
    await runExitTasks()
    expect(ran.sort()).toEqual(['async', 'sync'])
  })

  it('settles even when a task throws', async () => {
    register(() => {
      throw new Error('no daemon')
    })
    register(() => Promise.reject(new Error('no daemon')))
    await expect(runExitTasks()).resolves.toBeUndefined()
  })

  it('leaves a hung task behind rather than stalling the return', async () => {
    vi.useFakeTimers()
    register(() => new Promise<void>(() => {}))
    const settled = vi.fn()
    void runExitTasks().then(settled)
    await vi.advanceTimersByTimeAsync(2999)
    expect(settled).not.toHaveBeenCalled()
    await vi.advanceTimersByTimeAsync(1)
    expect(settled).toHaveBeenCalled()
  })

  it('forgets an unregistered task', async () => {
    const run = vi.fn()
    const off = registerExitTask(run)
    off()
    await runExitTasks()
    expect(run).not.toHaveBeenCalled()
  })
})
