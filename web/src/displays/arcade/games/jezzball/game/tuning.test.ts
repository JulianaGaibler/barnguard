import { describe, expect, it } from 'vitest'
import {
  FIXED_DT,
  GRID,
  PHYSICS,
  REF_BOARD_SIDE,
  ballRadiusWorld,
} from './tuning'
import { computeFieldGeom } from './layout'

describe('jezzball tuning invariants', () => {
  it('keeps ball displacement per fixed step under the tunneling bound', () => {
    // Worst-case (smallest) board the game is expected to run on.
    const geom = computeFieldGeom(
      { x: 0, y: 0, width: REF_BOARD_SIDE, height: REF_BOARD_SIDE },
      GRID.cols,
      GRID.rows,
    )
    const radius = ballRadiusWorld(geom.cell)
    const displacementPerStep = PHYSICS.ballSpeed * FIXED_DT
    // A ball must not cross more than a fraction of its own radius per step, or
    // the engine's discrete collision (no CCD) could tunnel a thin solid.
    expect(displacementPerStep).toBeLessThanOrEqual(
      radius * PHYSICS.tunnelSafety,
    )
  })

  it('has a sane physics configuration', () => {
    expect(PHYSICS.ballSpeed).toBeGreaterThan(0)
    expect(PHYSICS.restitution).toBe(1)
    expect(PHYSICS.friction).toBe(0)
    expect(PHYSICS.linearDamping).toBe(1)
    expect(PHYSICS.maxSpeedMultiple).toBeGreaterThanOrEqual(1)
    // Walls should outrun balls so a placed wall reads as decisive.
    expect(PHYSICS.wallGrowSpeed).toBeGreaterThan(PHYSICS.ballSpeed)
  })
})
