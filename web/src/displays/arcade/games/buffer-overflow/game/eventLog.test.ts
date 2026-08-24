import { describe, expect, it } from 'vitest'
import { formatEntry, pushEntry, stamp, type LogEntry } from './eventLog'

const entry = (at: number, label: string, points = 0): LogEntry => ({
  at,
  label,
  points,
  tone: 'plain',
})

describe('stamp', () => {
  it('pads the minutes, so a column of stamps stays a column', () => {
    expect(stamp(0)).toBe('00:00')
    expect(stamp(9)).toBe('00:09')
    expect(stamp(75)).toBe('01:15')
    expect(stamp(600)).toBe('10:00')
  })

  it('floors rather than rounding, so a stamp never reads ahead of the clock', () => {
    expect(stamp(9.9)).toBe('00:09')
  })

  it('never reports a negative time', () => {
    expect(stamp(-5)).toBe('00:00')
  })
})

describe('pushEntry', () => {
  it('appends, newest last', () => {
    const log = pushEntry(pushEntry([], entry(1, 'a'), 5), entry(2, 'b'), 5)
    expect(log.map((e) => e.label)).toEqual(['a', 'b'])
  })

  it('drops the oldest once it is full', () => {
    let log: LogEntry[] = []
    for (const label of ['a', 'b', 'c', 'd'])
      log = pushEntry(log, entry(0, label), 3)
    expect(log.map((e) => e.label)).toEqual(['b', 'c', 'd'])
  })

  it('does not mutate what it was given', () => {
    const first: LogEntry[] = [entry(1, 'a')]
    pushEntry(first, entry(2, 'b'), 5)
    expect(first).toHaveLength(1)
  })

  it('holds nothing when there is no room for a row', () => {
    expect(pushEntry([entry(1, 'a')], entry(2, 'b'), 0)).toEqual([])
  })
})

describe('formatEntry', () => {
  it('stamps a row and puts its points in their own column', () => {
    expect(formatEntry(entry(75, 'clear 2', 300), true)).toEqual({
      left: '01:15 clear 2',
      right: '+300',
    })
  })

  it('drops the stamp rather than the label when the pane is narrow', () => {
    // Which event fired is the information. When it fired is not, and a clipped
    // word is unreadable in a way a missing timestamp is not.
    expect(formatEntry(entry(75, 'clear 2', 300), false).left).toBe('clear 2')
  })

  it('leaves the points column empty for an event that scored nothing', () => {
    expect(formatEntry(entry(4, 'level 4'), true).right).toBe('')
  })
})
