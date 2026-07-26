import { describe, expect, it } from 'vitest'
import { SceneTree } from './SceneTree'
import { Node3D } from './Node3D'
import { MeshNode, createBoxGeometry } from '../nodes/MeshNode'
import { Camera3D } from '../camera/Camera3D'
import { raycastWorld3D } from './raycast3d'

const material = { lit: false, color: [1, 1, 1, 1] as [number, number, number, number] }

/** Mirror InputSystem's screen(css)→NDC mapping (full-canvas, y-flipped). */
function screenToNdc(sx: number, sy: number, cssW: number, cssH: number) {
  return { x: (2 * sx) / cssW - 1, y: 1 - (2 * sy) / cssH }
}

describe('3D pointer pick math', () => {
  it('center-screen NDC casts a ray that hits a centered cube', () => {
    const world = new SceneTree(new Node3D('world3d-root'))
    const cam = new Camera3D()
    cam.transform.setPosition(0, 0, 6)
    cam.setAspect(1)
    const cube = new MeshNode(createBoxGeometry(2), material)
    cube.hitEnabled = true
    cube.transform.setPosition(0, 0, 0)
    world.add(cube)
    world.updateTransforms()

    const ndc = screenToNdc(200, 150, 400, 300) // canvas center
    expect(ndc.x).toBeCloseTo(0, 6)
    expect(ndc.y).toBeCloseTo(0, 6)
    const ray = cam.screenToRay(ndc.x, ndc.y)
    const hit = raycastWorld3D(world, ray, (n) => n.hitEnabled)
    expect(hit?.node).toBe(cube)
  })

  it('the hit-enabled filter skips non-interactive meshes', () => {
    const world = new SceneTree(new Node3D('world3d-root'))
    const cam = new Camera3D()
    cam.transform.setPosition(0, 0, 6)
    cam.setAspect(1)
    const cube = new MeshNode(createBoxGeometry(2), material)
    // hitEnabled left false
    world.add(cube)
    world.updateTransforms()

    const ray = cam.screenToRay(0, 0)
    expect(raycastWorld3D(world, ray, (n) => n.hitEnabled)).toBeNull()
    // Without the filter it still picks (the manual-helper default).
    expect(raycastWorld3D(world, ray)?.node).toBe(cube)
  })

  it('a top-corner NDC misses a small centered cube', () => {
    const world = new SceneTree(new Node3D('world3d-root'))
    const cam = new Camera3D()
    cam.transform.setPosition(0, 0, 6)
    cam.setAspect(1)
    const cube = new MeshNode(createBoxGeometry(0.5), material)
    cube.hitEnabled = true
    world.add(cube)
    world.updateTransforms()

    const ndc = screenToNdc(4, 4, 400, 300) // near top-left corner
    const ray = cam.screenToRay(ndc.x, ndc.y)
    expect(raycastWorld3D(world, ray, (n) => n.hitEnabled)).toBeNull()
  })
})
