import { describe, it, expect } from 'vitest'
import { Engine } from '../engine/Engine'
import { MockGfxDevice } from './gfx/webgl2/mockGfxDevice'
import { CameraNode2D } from '../camera/CameraNode2D'
import { CameraNode3D } from '../camera/CameraNode3D'
import { Node2D } from '../scene/Node2D'

function makeEngine(): Engine {
  const canvas = document.createElement('canvas')
  return new Engine({ canvas, gpuDevice: new MockGfxDevice() })
}

describe('Stage camera registry (explicit cameras)', () => {
  it('starts with no camera; adding one makes it current (first-wins)', () => {
    const engine = makeEngine()
    const stage = engine.primaryStage
    expect(stage.currentCamera2D).toBe(null)
    expect(stage.currentCamera3D).toBe(null)
    // No cameras of any kind, so no 3D pass either.
    expect(stage.tree.has3D).toBe(false)

    const cam = new CameraNode2D()
    stage.tree.root.add(cam)
    expect(stage.currentCamera2D).toBe(cam)
    engine.destroy()
  })

  it('first-wins holds until another camera is made current', () => {
    const engine = makeEngine()
    const stage = engine.primaryStage
    const a = new CameraNode2D()
    const b = new CameraNode2D()
    stage.tree.root.add(a, b)
    expect(stage.currentCamera2D).toBe(a) // first attached
    b.makeCurrent()
    expect(stage.currentCamera2D).toBe(b)
    expect(b.isCurrent).toBe(true)
    engine.destroy()
  })

  it('pick-next on detach; empties to null when the last camera leaves', () => {
    const engine = makeEngine()
    const stage = engine.primaryStage
    const a = new CameraNode2D()
    const b = new CameraNode2D()
    stage.tree.root.add(a, b)
    b.makeCurrent()
    stage.tree.root.remove(b)
    expect(stage.currentCamera2D).toBe(a) // fell back to the other enabled one
    stage.tree.root.remove(a)
    expect(stage.currentCamera2D).toBe(null)
    engine.destroy()
  })

  it('disabling the current camera re-picks another (or null)', () => {
    const engine = makeEngine()
    const stage = engine.primaryStage
    const a = new CameraNode2D()
    const b = new CameraNode2D()
    stage.tree.root.add(a, b)
    a.makeCurrent()
    a.enabled = false
    expect(stage.currentCamera2D).toBe(b)
    engine.destroy()
  })

  it('makeCurrent() before attach is honored on register (wantsCurrent)', () => {
    const engine = makeEngine()
    const stage = engine.primaryStage
    const a = new CameraNode2D()
    const b = new CameraNode2D()
    b.makeCurrent() // deferred: no host yet
    stage.tree.root.add(a, b)
    expect(stage.currentCamera2D).toBe(b)
    engine.destroy()
  })

  it('register is idempotent under reparent within the same stage', () => {
    const engine = makeEngine()
    const stage = engine.primaryStage
    const parentA = new Node2D()
    const parentB = new Node2D()
    stage.tree.root.add(parentA, parentB)
    const cam = new CameraNode2D()
    parentA.add(cam)
    cam.makeCurrent()
    expect(stage.currentCamera2D).toBe(cam)
    parentB.add(cam) // detach from A, attach under B
    expect(stage.cameras2d.filter((c) => c === cam).length).toBe(1)
    cam.makeCurrent()
    expect(stage.currentCamera2D).toBe(cam)
    engine.destroy()
  })

  it('destroyChildren removes non-intrinsic cameras (current → null)', () => {
    const engine = makeEngine()
    const stage = engine.primaryStage
    const cam = new CameraNode2D()
    stage.tree.root.add(cam)
    cam.makeCurrent()
    stage.tree.root.destroyChildren()
    expect(cam.isDestroyed).toBe(true)
    expect(stage.currentCamera2D).toBe(null)
    engine.destroy()
  })

  it('an intrinsic camera survives destroyChildren and stays current', () => {
    const engine = makeEngine()
    const stage = engine.primaryStage
    const cam = new CameraNode2D()
    cam.intrinsic = true
    stage.tree.root.add(cam)
    stage.tree.root.destroyChildren()
    expect(cam.isDestroyed).toBe(false)
    expect(stage.currentCamera2D).toBe(cam)
    engine.destroy()
  })

  it('a 3D camera drives has3D like any 3D node; none until added', () => {
    const engine = makeEngine()
    const stage = engine.primaryStage
    expect(stage.currentCamera3D).toBe(null)
    const cam3d = new CameraNode3D()
    stage.tree.root.add(cam3d)
    expect(stage.currentCamera3D).toBe(cam3d)
    // Intrinsic-skip does not apply here (not intrinsic), but a bare camera is
    // still a 3D node, so has3D reflects it.
    expect(stage.tree.has3D).toBe(true)
    engine.destroy()
  })
})
