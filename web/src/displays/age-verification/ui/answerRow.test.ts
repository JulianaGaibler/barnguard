import { describe, expect, it } from 'vitest'
import { AnswerRow, RESTING_POSE } from './answerRow'

describe('AnswerRow', () => {
  it('puts the slot at the row corner and the tile on the square center', () => {
    const row = new AnswerRow('A')
    row.place(1024, 300)
    expect([row.slot.transform.x, row.slot.transform.y]).toEqual([1024, 300])
    expect([row.tile.transform.x, row.tile.transform.y]).toEqual([1088, 364])
    expect(row.center).toEqual({ x: 1088, y: 364 })
  })

  it('draws a black square and a white letter at rest', () => {
    const row = new AnswerRow('B')
    expect(row.square.fill).toBe('rgb(22, 22, 22)')
    expect(row.letter.text).toBe('B')
    expect(row.pose).toEqual(RESTING_POSE)
  })

  it('centers the letter by its cap height', () => {
    const row = new AnswerRow('A')
    // Without the font loaded the cap height falls back to 0.7 of the size.
    expect(row.letter.y).toBeGreaterThan(0)
    expect(row.letter.align).toBe('center')
    expect(row.letter.baseline).toBe('alphabetic')
  })

  it('moves the slot and the tile together by the offset', () => {
    const row = new AnswerRow('A')
    row.place(100, 200)
    row.pose.offsetX = 50
    row.pose.offsetY = -20
    row.apply()
    expect([row.slot.transform.x, row.slot.transform.y]).toEqual([150, 180])
    expect([row.tile.transform.x, row.tile.transform.y]).toEqual([214, 244])
  })

  it('adds the flight to the tile alone', () => {
    const row = new AnswerRow('A')
    row.place(100, 200)
    row.pose.flightX = -300
    row.pose.flightY = -150
    row.apply()
    expect(row.slot.transform.x).toBe(100)
    expect(row.tile.transform.x).toBe(164 - 300)
    expect(row.tile.transform.y).toBe(264 - 150)
  })

  it('fades the label and the tile separately', () => {
    const row = new AnswerRow('A')
    row.pose.labelAlpha = 0
    row.apply()
    expect(row.slot.transform.alpha).toBe(0)
    expect(row.tile.transform.alpha).toBe(1)
    row.pose.alpha = 0.4
    row.pose.letterAlpha = 0
    row.apply()
    expect(row.tile.transform.alpha).toBe(0.4)
    expect(row.letter.transform.alpha).toBe(0)
  })

  it('scales the tile around its center', () => {
    const row = new AnswerRow('A')
    row.pose.scale = 0.28
    row.apply()
    expect(row.tile.transform.scaleX).toBe(0.28)
    expect(row.tile.transform.scaleY).toBe(0.28)
  })

  it('turns into a circle and goes red', () => {
    const row = new AnswerRow('A')
    row.pose.radius = 64
    row.pose.red = 1
    row.apply()
    expect(row.square.geometry).toMatchObject({ kind: 'rect', radii: 64 })
    expect(row.square.fill).toBe('rgb(255, 69, 63)')
  })

  it('never rounds the corners past a circle', () => {
    const row = new AnswerRow('A')
    // An overshooting ease can go past half the side.
    row.pose.radius = 90
    row.apply()
    expect(row.square.geometry).toMatchObject({ radii: 64 })
  })

  it('mixes the fill between black and red', () => {
    const row = new AnswerRow('A')
    row.pose.red = 0.5
    row.apply()
    expect(row.square.fill).not.toBe('rgb(22, 22, 22)')
    expect(row.square.fill).not.toBe('rgb(255, 69, 63)')
  })

  it('adds its nodes to a parent and removes them with it', () => {
    const row = new AnswerRow('A')
    const parent = new (row.slot.constructor as new () => typeof row.slot)()
    row.attachTo(parent)
    expect(parent.children).toContain(row.slot)
    expect(parent.children).toContain(row.tile)
    row.destroy()
    expect(row.slot.isDestroyed).toBe(true)
    expect(row.tile.isDestroyed).toBe(true)
  })
})
