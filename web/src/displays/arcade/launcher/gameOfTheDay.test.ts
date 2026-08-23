import { describe, it, expect } from 'vitest'
import { boothDay, dailyOrder } from './gameOfTheDay'

const ZONE = 'Europe/Berlin'

/** An instant on a given UTC date, mid-morning so Berlin is on the same date. */
const at = (isoDate: string, utcTime = '10:00') =>
  Date.parse(`${isoDate}T${utcTime}:00Z`)

/** The registry's current size, the one the year-boundary case turns on. */
const SEVEN = ['a', 'b', 'c', 'd', 'e', 'f', 'g']

describe('boothDay', () => {
  it('advances by exactly one per calendar day', () => {
    expect(
      boothDay(at('2026-08-24'), ZONE) - boothDay(at('2026-08-23'), ZONE),
    ).toBe(1)
  })

  it('holds steady from one end of a day to the other', () => {
    expect(boothDay(at('2026-08-23', '00:30'), ZONE)).toBe(
      boothDay(at('2026-08-23', '21:00'), ZONE),
    )
  })

  it('turns over at the booth’s midnight, not the runner’s', () => {
    // 22:30 UTC is already half past midnight in Berlin, so this belongs to
    // the following day even though the UTC date still reads the 23rd.
    expect(boothDay(at('2026-08-23', '22:30'), ZONE)).toBe(
      boothDay(at('2026-08-24'), ZONE),
    )
  })

  it('counts a spring-forward day as one day', () => {
    // Berlin loses an hour overnight on 2026-03-29.
    const before = boothDay(at('2026-03-28'), ZONE)
    expect(boothDay(at('2026-03-29'), ZONE)).toBe(before + 1)
    expect(boothDay(at('2026-03-30'), ZONE)).toBe(before + 2)
  })

  it('steps across New Year like any other day', () => {
    expect(
      boothDay(at('2027-01-01'), ZONE) - boothDay(at('2026-12-31'), ZONE),
    ).toBe(1)
  })
})

describe('dailyOrder', () => {
  it('moves the day’s pick to the front and leaves the rest alone', () => {
    // 7 % 3 === 1, so the middle game leads and 'a' falls in behind it.
    expect(dailyOrder(['a', 'b', 'c'], 7)).toEqual({
      featured: 'b',
      games: ['b', 'a', 'c'],
    })
  })

  it('gives every game the lead exactly once per cycle', () => {
    const led = Array.from(
      { length: SEVEN.length },
      (_, i) => dailyOrder(SEVEN, 100 + i).featured,
    )
    expect([...led].sort()).toEqual([...SEVEN].sort())
  })

  it('picks a different game than the day before across New Year', () => {
    // Day-of-year would repeat here: 365 % 7 === 1 === 1 % 7.
    const eve = boothDay(at('2026-12-31'), ZONE)
    const day = boothDay(at('2027-01-01'), ZONE)
    expect(dailyOrder(SEVEN, day).featured).not.toBe(
      dailyOrder(SEVEN, eve).featured,
    )
  })

  it('hands back the same array when the pick already leads', () => {
    const games = ['a', 'b', 'c']
    // 6 % 3 === 0.
    expect(dailyOrder(games, 6).games).toBe(games)
  })

  it('stays in range on a clock set before 1970', () => {
    expect(dailyOrder(['a', 'b', 'c'], -1).featured).toBe('c')
  })

  it('reports no pick for an empty registry', () => {
    expect(dailyOrder([], 7)).toEqual({ featured: null, games: [] })
  })
})
