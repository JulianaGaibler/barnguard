import { describe, expect, it } from 'vitest'
import { IDLE_QUIT_MS, IDLE_WARN_MS, isExpired, isWarning } from './idle'

const WARN_AT = IDLE_QUIT_MS - IDLE_WARN_MS

describe('isWarning', () => {
  it('holds off until the warning window opens', () => {
    expect(isWarning(0)).toBe(false)
    expect(isWarning(WARN_AT - 1)).toBe(false)
    expect(isWarning(WARN_AT)).toBe(true)
  })

  it('stays true through the quit', () => {
    expect(isWarning(IDLE_QUIT_MS)).toBe(true)
  })
})

describe('isExpired', () => {
  it('waits out the whole warning window', () => {
    expect(isExpired(WARN_AT)).toBe(false)
    expect(isExpired(IDLE_QUIT_MS - 1)).toBe(false)
    expect(isExpired(IDLE_QUIT_MS)).toBe(true)
  })
})

it('leaves the notice enough time to be read', () => {
  expect(IDLE_WARN_MS).toBeLessThan(IDLE_QUIT_MS)
})
