import { describe, expect, it } from 'vitest'
import { deviceBoundsOfRect, padBox, type DeviceBox } from './layerBox'

const IDENTITY = { a: 1, b: 0, c: 0, d: 1, e: 0, f: 0 }
const box = (
  x: number,
  y: number,
  width: number,
  height: number,
): DeviceBox => ({
  x,
  y,
  width,
  height,
})

describe('deviceBoundsOfRect', () => {
  it('carries a rect through the world and render matrices', () => {
    const world = { ...IDENTITY, e: 10, f: 20 }
    const render = { ...IDENTITY, a: 2, d: 2, e: 5 }
    const out = deviceBoundsOfRect(
      { x: 0, y: 0, width: 30, height: 10 },
      world,
      render,
      box(0, 0, 0, 0),
    )
    expect(out).toEqual({ x: 25, y: 40, width: 60, height: 20 })
  })

  it('bounds a rotated rect by all four corners', () => {
    // A quarter turn: x maps to y and y to minus x.
    const world = { a: 0, b: 1, c: -1, d: 0, e: 0, f: 0 }
    const out = deviceBoundsOfRect(
      { x: 0, y: 0, width: 30, height: 10 },
      world,
      IDENTITY,
      box(0, 0, 0, 0),
    )
    expect(out).toEqual({ x: -10, y: 0, width: 10, height: 30 })
  })
})

describe('padBox', () => {
  it('grows every side', () => {
    expect(padBox(box(10, 10, 20, 20), 4)).toEqual(box(6, 6, 28, 28))
  })

  it('leaves the box alone for no padding', () => {
    expect(padBox(box(10, 10, 20, 20), 0)).toEqual(box(10, 10, 20, 20))
  })
})
