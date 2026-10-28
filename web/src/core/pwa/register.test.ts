import { describe, expect, it } from 'vitest'
import { UPDATE_IDLE_MS, shouldApplyUpdate } from './register'

describe('shouldApplyUpdate', () => {
  it('waits for an update to be there', () => {
    expect(shouldApplyUpdate(false, UPDATE_IDLE_MS * 10, true)).toBe(false)
    expect(shouldApplyUpdate(false, 0, false)).toBe(false)
  })

  it('applies at once when nobody has used the page yet', () => {
    expect(shouldApplyUpdate(true, 0, false)).toBe(true)
  })

  it('waits for the screen to be idle once someone has used it', () => {
    expect(shouldApplyUpdate(true, UPDATE_IDLE_MS - 1, true)).toBe(false)
    expect(shouldApplyUpdate(true, UPDATE_IDLE_MS, true)).toBe(true)
  })
})
