import { describe, expect, it } from 'vitest'
import { raycastMesh, raycastWorld3D } from './raycast3d'
import { SceneTree } from './SceneTree'
import { Node3D } from './Node3D'
import { MeshNode, createBoxGeometry } from '../nodes/MeshNode'
import type { Ray } from '../math/Ray'

const material = {
  lit: false,
  color: [1, 1, 1, 1] as [number, number, number, number],
}

describe('raycastMesh', () => {
  it('hits a box straight ahead and reports its distance', () => {
    const world = new SceneTree(new Node3D('world3d-root'))
    const box = new MeshNode(createBoxGeometry(2), material)
    box.transform.setPosition(0, 0, -10)
    world.add(box)
    world.updateTransforms()

    const ray: Ray = {
      origin: { x: 0, y: 0, z: 0 },
      direction: { x: 0, y: 0, z: -1 },
    }
    const dist = raycastMesh(ray, box)
    // Box half-extent 1 at z=-10 → front face at z=-9, distance 9.
    expect(dist).toBeCloseTo(9, 4)
  })

  it('misses a box off to the side', () => {
    const world = new SceneTree(new Node3D('world3d-root'))
    const box = new MeshNode(createBoxGeometry(1), material)
    box.transform.setPosition(50, 0, -10)
    world.add(box)
    world.updateTransforms()
    const ray: Ray = {
      origin: { x: 0, y: 0, z: 0 },
      direction: { x: 0, y: 0, z: -1 },
    }
    expect(raycastMesh(ray, box)).toBeNull()
  })
})

describe('raycastWorld3D', () => {
  it('returns the nearest of several hits', () => {
    const world = new SceneTree(new Node3D('world3d-root'))
    const near = new MeshNode(createBoxGeometry(1), material)
    near.transform.setPosition(0, 0, -5)
    const far = new MeshNode(createBoxGeometry(1), material)
    far.transform.setPosition(0, 0, -20)
    world.add(near, far)
    world.updateTransforms()

    const ray: Ray = {
      origin: { x: 0, y: 0, z: 0 },
      direction: { x: 0, y: 0, z: -1 },
    }
    const hit = raycastWorld3D(world, ray)
    expect(hit?.node).toBe(near)
  })

  it('ignores invisible meshes', () => {
    const world = new SceneTree(new Node3D('world3d-root'))
    const box = new MeshNode(createBoxGeometry(1), material)
    box.transform.setPosition(0, 0, -5)
    box.visible = false
    world.add(box)
    world.updateTransforms()
    const ray: Ray = {
      origin: { x: 0, y: 0, z: 0 },
      direction: { x: 0, y: 0, z: -1 },
    }
    expect(raycastWorld3D(world, ray)).toBeNull()
  })
})
