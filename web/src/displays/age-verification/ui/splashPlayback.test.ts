import { describe, expect, it } from 'vitest'
import { parsePlayback, PLAYING } from './splashPlayback'

describe('parsePlayback', () => {
  it('plays when nothing is stored', () => {
    expect(parsePlayback(null)).toEqual(PLAYING)
    expect(parsePlayback('')).toEqual(PLAYING)
  })

  it('reads a paused frame back', () => {
    expect(parsePlayback('{"paused":true,"frame":640.5}')).toEqual({
      paused: true,
      frame: 640.5,
    })
  })

  it('ignores anything it cannot read', () => {
    expect(parsePlayback('not json')).toEqual(PLAYING)
    expect(parsePlayback('null')).toEqual(PLAYING)
    expect(parsePlayback('{"paused":"yes","frame":-4}')).toEqual(PLAYING)
    expect(parsePlayback('{"paused":true,"frame":"x"}')).toEqual({
      paused: true,
      frame: 0,
    })
  })
})
