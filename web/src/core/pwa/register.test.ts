import { describe, expect, it } from 'vitest'
import { UPDATE_IDLE_MS, shouldApplyUpdate } from './register'

describe('shouldApplyUpdate', () => {
  it('waits for an update to be there', () => {
    expect(shouldApplyUpdate(false, UPDATE_IDLE_MS * 10)).toBe(false)
  })

  it('waits for the screen to be idle', () => {
    expect(shouldApplyUpdate(true, UPDATE_IDLE_MS - 1)).toBe(false)
    expect(shouldApplyUpdate(true, UPDATE_IDLE_MS)).toBe(true)
  })
})
