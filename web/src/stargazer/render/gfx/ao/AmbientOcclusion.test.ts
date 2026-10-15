import { describe, expect, it } from 'vitest'
import { AmbientOcclusion } from './AmbientOcclusion'
import { MeshRenderer } from '../MeshRenderer'
import { MockGfxDevice } from '../webgl2/mockGfxDevice'
import type { GfxBackend } from '../GfxDevice'
import { Camera3D } from '../../../camera/Camera3D'
import { SceneTree } from '../../../scene/SceneTree'
import { Node3D } from '../../../scene/Node3D'
import { MeshNode, createBoxGeometry } from '../../../nodes/MeshNode'

const TARGET = {
  format: 'linear' as const,
  samples: 4,
  depthStencil: 'depth' as const,
}

async function untilReady(...ready: (() => boolean)[]): Promise<void> {
  for (let i = 0; i < 200 && !ready.every((r) => r()); i++)
    await Promise.resolve()
}

async function setup(backend: GfxBackend) {
  const device = new MockGfxDevice(backend)
  const mesh = new MeshRenderer(device, TARGET)
  const ao = new AmbientOcclusion(device)
  await untilReady(
    () => mesh.ready,
    () => ao.ready,
  )
  const world = new SceneTree(new Node3D('world3d-root'))
  const camera = new Camera3D()
  camera.transform.setPosition(0, 0, 5)
  camera.setAspect(1)
  world.add(
    new MeshNode(createBoxGeometry(1), { lit: true, color: [1, 1, 1, 1] }),
  )
  world.updateTransforms()
  device.reset()
  return { device, mesh, ao, world, camera }
}

describe('AmbientOcclusion controller', () => {
  it('generates AO with a compute dispatch on WebGPU', async () => {
    const { device, mesh, ao, world, camera } = await setup('webgpu')
    ao.enabled = true
    device.beginFrame()
    ao.run(camera, world.root, mesh, 128, 128)
    device.endFrame()

    // G-buffer prepass drew the mesh.
    expect(
      device.draws.some((d) => d.pipeline.desc.label === 'ao-gbuffer'),
    ).toBe(true)
    // Generate + blur H + blur V, all in one compute pass.
    expect(device.computeDispatches).toHaveLength(3)
    expect(device.computePassBegins).toBe(1)
    expect(ao.aoTexture).not.toBeNull()
    // 128 / 8 = 16 workgroups per axis.
    expect(device.computeDispatches[0].x).toBe(16)
    expect(device.computeDispatches[0].y).toBe(16)
  })

  it('generates AO with a fullscreen fragment pass on WebGL2', async () => {
    const { device, mesh, ao, world, camera } = await setup('webgl2')
    ao.enabled = true
    device.beginFrame()
    ao.run(camera, world.root, mesh, 128, 128)
    device.endFrame()

    expect(device.computeDispatches).toHaveLength(0)
    // Three fullscreen passes (3-vertex draws, no index): generate + blur H + V.
    const aoDraws = device.draws.filter(
      (d) => d.vertexCount === 3 && d.indexBuffer === undefined,
    )
    expect(aoDraws).toHaveLength(3)
    expect(ao.aoTexture).not.toBeNull()
  })

  it('is a no-op when disabled', async () => {
    const { device, mesh, ao, world, camera } = await setup('webgpu')
    // enabled defaults to false
    device.beginFrame()
    ao.run(camera, world.root, mesh, 128, 128)
    device.endFrame()
    expect(device.draws).toHaveLength(0)
    expect(device.computeDispatches).toHaveLength(0)
  })

  it('frees targets when disabled', async () => {
    const { device, mesh, ao, world, camera } = await setup('webgpu')
    ao.enabled = true
    ao.run(camera, world.root, mesh, 128, 128)
    const before = device.deletedRenderTargets
    ao.enabled = false
    expect(device.deletedRenderTargets).toBeGreaterThan(before)
    expect(ao.aoTexture).toBeNull()
  })

  it('renders at half size, rounding up, at half resolution', async () => {
    const { device, mesh, ao, world, camera } = await setup('webgpu')
    ao.enabled = true
    ao.resolution = 'half'
    expect(ao.targetSize(129, 64)).toEqual({ w: 65, h: 32 })
    ao.run(camera, world.root, mesh, 129, 64)
    const gbuffer = device.renderTargets.at(-1)!
    expect([gbuffer.width, gbuffer.height]).toEqual([65, 32])
    // 65 / 8 rounds up to 9 workgroups, 32 / 8 is 4.
    expect(device.computeDispatches[0].x).toBe(9)
    expect(device.computeDispatches[0].y).toBe(4)
  })

  it('rebuilds its targets once when the resolution changes', async () => {
    const { device, mesh, ao, world, camera } = await setup('webgl2')
    ao.enabled = true
    ao.run(camera, world.root, mesh, 128, 128)
    const created = device.renderTargets.length
    ao.resolution = 'half'
    ao.run(camera, world.root, mesh, 128, 128)
    ao.run(camera, world.root, mesh, 128, 128)
    const added = device.renderTargets.slice(created)
    // The G-buffer and the two AO buffers, once, at 64 by 64.
    expect(added).toHaveLength(3)
    expect(added.every((t) => t.width === 64 && t.height === 64)).toBe(true)
  })
})
