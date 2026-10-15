import { describe, expect, it } from 'vitest'
import { Node2D, SceneTree } from '@src/stargazer'
import {
  ACTIONS_WIDTH,
  NAME_FIELD_WIDTH,
  PREVIEW_SIZE,
  buildPrintPickerLayout,
} from './printPickerLayout'
import { buildGameOverLayout } from './gameOverLayout'

function laidOut(width: number, height: number) {
  const rect = { x: 0, y: 0, width, height }
  const picker = buildPrintPickerLayout(() => rect)
  const summary = buildGameOverLayout(() => rect)
  const scene = new SceneTree(new Node2D('scene-root'))
  scene.root.add(picker.lift, summary.root)
  picker.root._runIfDirty()
  summary.root._runIfDirty()
  scene.updateTransforms()
  return { picker, summary }
}

const topLeft = (node: Node2D) => node.localToWorld(0, 0)

describe('buildPrintPickerLayout', () => {
  it('lines the previews up with the game over cards', () => {
    const { picker, summary } = laidOut(1920, 1080)
    picker.previews.forEach((preview, i) => {
      expect(topLeft(preview).x).toBeCloseTo(topLeft(summary.cards[i]).x, 1)
    })
  })

  it('centres the column in the region', () => {
    const { picker } = laidOut(1920, 1080)
    expect(topLeft(picker.name).x + NAME_FIELD_WIDTH / 2).toBeCloseTo(960, 1)
    expect(topLeft(picker.actions).x + ACTIONS_WIDTH / 2).toBeCloseTo(960, 1)
    const first = topLeft(picker.previews[0]).y
    expect(first + PREVIEW_SIZE / 2).toBeGreaterThan(400)
    expect(first + PREVIEW_SIZE / 2).toBeLessThan(680)
  })

  it('moves everything with the lift', () => {
    const { picker } = laidOut(1920, 1080)
    const before = topLeft(picker.previews[1]).y
    picker.lift.transform.y = -100
    picker.lift.scene!.updateTransforms()
    expect(topLeft(picker.previews[1]).y).toBeCloseTo(before - 100, 1)
  })
})
