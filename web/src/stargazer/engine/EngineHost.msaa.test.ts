import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { resolveMsaaSamples } from './EngineHost'

/**
 * `resolveMsaaSamples` reads `?msaa=N` from the URL when no explicit option is
 * passed, else honours the option. Default is 4× MSAA (WebGL2 minimum, gives
 * visible fill-edge AA without unreasonable bandwidth cost).
 */
describe('resolveMsaaSamples', () => {
  const originalSearch = window.location.search
  const setSearch = (search: string): void => {
    // happy-dom lets us set window.location.search directly.
    ;(window.location as unknown as { search: string }).search = search
  }

  beforeEach(() => {
    setSearch('')
  })

  afterEach(() => {
    setSearch(originalSearch)
  })

  it('returns the explicit option when provided', () => {
    expect(resolveMsaaSamples(2)).toBe(2)
    expect(resolveMsaaSamples(8)).toBe(8)
    expect(resolveMsaaSamples(0)).toBe(0)
  })

  it('reads ?msaa=N from the URL when no explicit option', () => {
    setSearch('?msaa=8')
    expect(resolveMsaaSamples()).toBe(8)
    setSearch('?msaa=2')
    expect(resolveMsaaSamples()).toBe(2)
    setSearch('?msaa=0')
    expect(resolveMsaaSamples()).toBe(0)
  })

  it('defaults to 4× when the URL param is absent or invalid', () => {
    setSearch('')
    expect(resolveMsaaSamples()).toBe(4)
    setSearch('?msaa=')
    expect(resolveMsaaSamples()).toBe(4)
    setSearch('?msaa=nope')
    expect(resolveMsaaSamples()).toBe(4)
    setSearch('?msaa=-1')
    expect(resolveMsaaSamples()).toBe(4)
  })

  it('explicit option beats URL', () => {
    setSearch('?msaa=8')
    expect(resolveMsaaSamples(0)).toBe(0)
    expect(resolveMsaaSamples(2)).toBe(2)
  })
})
