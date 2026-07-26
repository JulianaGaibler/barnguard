import { describe, expect, it } from 'vitest'
import { MeshRenderer } from './MeshRenderer'
import { MockGfxDevice } from './webgl2/mockGfxDevice'
import { Camera3D } from '../../camera/Camera3D'
import { SceneTree } from '../../scene/SceneTree'
import { Node3D } from '../../scene/Node3D'
import { MeshNode, createBoxGeometry } from '../../nodes/MeshNode'

function setup() {
  const device = new MockGfxDevice()
  const renderer = new MeshRenderer(device)
  const world = new SceneTree(new Node3D('world3d-root'))
  const camera = new Camera3D()
  camera.transform.setPosition(0, 0, 5)
  camera.setAspect(1)
  return { device, renderer, world, camera }
}

describe('MeshRenderer', () => {
  it('draws an uploaded mesh with depth test and back-face culling', () => {
    const { device, renderer, world, camera } = setup()
    const cube = new MeshNode(createBoxGeometry(1), { lit: true, color: [1, 0, 0, 1] })
    cube.transform.setPosition(0, 0, 0)
    world.add(cube)
    world.updateTransforms()

    renderer.render(camera, world.root)

    const elementDraws = device.draws.filter((d) => d.kind === 'elements')
    expect(elementDraws).toHaveLength(1)
    // A box has 36 indices (6 faces × 2 triangles × 3).
    expect(elementDraws[0].count).toBe(36)
    expect(device.depthTest).toBe(true)
    expect(device.cull).toBe('back')
  })

  it('uploads a u16 index buffer for a small mesh', () => {
    const { device, renderer, world, camera } = setup()
    world.add(new MeshNode(createBoxGeometry(1), { lit: false, color: [1, 1, 1, 1] }))
    world.updateTransforms()
    renderer.render(camera, world.root)
    expect(device.indexBufferTypes.at(-1)).toBe('u16')
  })

  it('skips a mesh whose geometry has not loaded yet', () => {
    const { device, renderer, world, camera } = setup()
    world.add(new MeshNode(null, { lit: false, color: [1, 1, 1, 1] }))
    world.updateTransforms()
    renderer.render(camera, world.root)
    expect(device.draws.filter((d) => d.kind === 'elements')).toHaveLength(0)
  })

  it('reuses the GPU upload across frames', () => {
    const { device, renderer, world, camera } = setup()
    world.add(new MeshNode(createBoxGeometry(1), { lit: true, color: [1, 1, 1, 1] }))
    world.updateTransforms()
    renderer.render(camera, world.root)
    const buffersAfterFirst = device.buffers.length
    renderer.render(camera, world.root)
    // No new vertex buffers on the second frame — the mesh is cached.
    expect(device.buffers.length).toBe(buffersAfterFirst)
  })

  it('draws nothing for an empty world', () => {
    const { device, renderer, world, camera } = setup()
    world.updateTransforms()
    renderer.render(camera, world.root)
    expect(device.draws).toHaveLength(0)
  })
})
