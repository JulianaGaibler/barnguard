import { describe, expect, it } from 'vitest'
import { IDLE_RESET_MS, IDLE_WARN_MS, isExpired, isWarning } from './idle'

describe('idle', () => {
  it('warns for the last stretch before the reset', () => {
    expect(isWarning(IDLE_RESET_MS - IDLE_WARN_MS - 1)).toBe(false)
    expect(isWarning(IDLE_RESET_MS - IDLE_WARN_MS)).toBe(true)
    expect(isExpired(IDLE_RESET_MS - 1)).toBe(false)
  })

  it('expires at the reset', () => {
    expect(isExpired(IDLE_RESET_MS)).toBe(true)
  })
})
