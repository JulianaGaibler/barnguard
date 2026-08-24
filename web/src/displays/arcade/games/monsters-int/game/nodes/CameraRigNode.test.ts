import { describe, expect, it } from 'vitest'
import { cameraSlide, focalFor } from './CameraRigNode'
import { PX_TO_M, groundFromLayout, layoutFromWorld } from '../project'
import { REGION_HEIGHT, REGION_WIDTH, layout } from '../../../../world'

// The 3D camera has to move in lockstep with a 2D camera it shares nothing
// with. These pin the arithmetic that keeps the table glued to the pan, which
// is otherwise only checkable by watching the transition.

const gameView = () => ({
  x: 0,
  y: 0,
  width: REGION_WIDTH,
  height: REGION_HEIGHT,
})
const launcherView = () => ({
  x: 0,
  y: layout.launcherTop,
  width: REGION_WIDTH,
  height: REGION_HEIGHT,
})

describe('cameraSlide', () => {
  it('does not move while the camera frames the game region', () => {
    const slide = cameraSlide(gameView())
    expect(slide.right).toBeCloseTo(0, 12)
    expect(slide.up).toBeCloseTo(0, 12)
  })

  it('drops the camera by the distance the launcher is away', () => {
    const slide = cameraSlide(launcherView())
    // The launcher is below, so the table has to ride up out of frame, which
    // means the camera goes down.
    expect(slide.up).toBeLessThan(0)
    expect(slide.up).toBeCloseTo(-layout.launcherTop * PX_TO_M, 9)
    expect(slide.right).toBe(0)
  })

  it('is linear through the pan, so the table tracks it exactly', () => {
    const half = {
      x: 0,
      y: layout.launcherTop / 2,
      width: REGION_WIDTH,
      height: REGION_HEIGHT,
    }
    const end = cameraSlide(launcherView()).up
    expect(cameraSlide(half).up).toBeCloseTo(end / 2, 9)
  })

  it('follows a horizontal framing too, opposite to the content', () => {
    const shifted = { x: 400, y: 0, width: REGION_WIDTH, height: REGION_HEIGHT }
    expect(cameraSlide(shifted).right).toBeCloseTo(400 * PX_TO_M, 9)
  })
})

describe('focalFor', () => {
  it('puts one design pixel on one millimetre of table', () => {
    // The ortho extent is `2 * tan(fovY / 2) * focalDistance` by construction,
    // so recovering the height from the focal distance is the round trip.
    const focal = focalFor(REGION_HEIGHT)
    const halfFov = ((35 / 2) * Math.PI) / 180
    const extent = 2 * Math.tan(halfFov) * focal
    expect(extent).toBeCloseTo(REGION_HEIGHT * PX_TO_M, 9)
  })

  it('scales with the visible height, so a taller canvas shows more table', () => {
    expect(focalFor(2 * REGION_HEIGHT)).toBeCloseTo(
      2 * focalFor(REGION_HEIGHT),
      9,
    )
  })

  it('frames the region the projection maps to', () => {
    // A point one region-height below centre must land on the bottom edge.
    const bottom = groundFromLayout(REGION_WIDTH / 2, REGION_HEIGHT)
    expect(layoutFromWorld(bottom).y).toBeCloseTo(REGION_HEIGHT, 6)
  })
})
