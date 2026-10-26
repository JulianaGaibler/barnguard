import { afterEach, describe, expect, it, vi } from 'vitest'
import { isInstalledApp, keepAwake, lockGestures } from './appMode'

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('isInstalledApp', () => {
  it('is true in a standalone or fullscreen window', () => {
    vi.stubGlobal('matchMedia', (query: string) => ({
      matches: query === '(display-mode: standalone)',
    }))
    expect(isInstalledApp()).toBe(true)
  })

  it('is false in a browser tab', () => {
    vi.stubGlobal('matchMedia', () => ({ matches: false }))
    expect(isInstalledApp()).toBe(false)
  })
})

describe('lockGestures', () => {
  it('cancels a pinch and lets go when it is undone', () => {
    const undo = lockGestures(document)
    const pinch = new Event('gesturestart', { cancelable: true })
    document.dispatchEvent(pinch)
    expect(pinch.defaultPrevented).toBe(true)
    undo()
    const again = new Event('gesturestart', { cancelable: true })
    document.dispatchEvent(again)
    expect(again.defaultPrevented).toBe(false)
  })
})

describe('keepAwake', () => {
  it('holds a screen lock and releases it', async () => {
    const release = vi.fn(async () => {})
    const request = vi.fn(async () => ({ release }))
    vi.stubGlobal('navigator', { wakeLock: { request } })
    const stop = keepAwake()
    await Promise.resolve()
    expect(request).toHaveBeenCalledWith('screen')
    stop()
    expect(release).toHaveBeenCalled()
  })

  it('does nothing where there is no wake lock', () => {
    vi.stubGlobal('navigator', {})
    expect(() => keepAwake()()).not.toThrow()
  })
})
