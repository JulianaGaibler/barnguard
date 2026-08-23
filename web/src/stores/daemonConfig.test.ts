import { describe, it, expect, beforeEach } from 'vitest'
import { get } from 'svelte/store'
import {
  DEFAULT_LABEL_URL,
  DEFAULT_LATITUDE,
  DEFAULT_LONGITUDE,
  DEFAULT_TIMEZONE,
  daemonConfig,
  setDaemonConfig,
} from './daemonConfig'

describe('setDaemonConfig', () => {
  beforeEach(() => setDaemonConfig({}))

  it('starts from the Berlin defaults', () => {
    const c = get(daemonConfig)
    expect(c.labelUrl).toBe(DEFAULT_LABEL_URL)
    expect(c.latitude).toBe(DEFAULT_LATITUDE)
    expect(c.longitude).toBe(DEFAULT_LONGITUDE)
    expect(c.timezone).toBe(DEFAULT_TIMEZONE)
  })

  it('keeps defaults for keys a snapshot omits', () => {
    // The SSE frame is cast rather than validated, so a daemon older than the
    // location fields would otherwise write `undefined` into them and carry a
    // NaN through the whole solar chain.
    setDaemonConfig({ labelUrl: 'mzl.la/booth', labelUrlOverridden: true })
    const c = get(daemonConfig)
    expect(c.labelUrl).toBe('mzl.la/booth')
    expect(c.labelUrlOverridden).toBe(true)
    expect(c.latitude).toBe(DEFAULT_LATITUDE)
    expect(c.timezone).toBe(DEFAULT_TIMEZONE)
  })

  it('takes every value a full snapshot carries', () => {
    setDaemonConfig({
      labelUrl: 'mzl.la/booth',
      labelUrlOverridden: false,
      latitude: 64.15,
      longitude: -21.94,
      timezone: 'Atlantic/Reykjavik',
    })
    const c = get(daemonConfig)
    expect(c.latitude).toBe(64.15)
    expect(c.longitude).toBe(-21.94)
    expect(c.timezone).toBe('Atlantic/Reykjavik')
  })

  it('ignores a null where a number belongs', () => {
    setDaemonConfig({ latitude: null as unknown as number })
    expect(get(daemonConfig).latitude).toBe(DEFAULT_LATITUDE)
  })
})
