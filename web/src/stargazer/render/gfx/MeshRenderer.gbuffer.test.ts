import { describe, expect, it } from 'vitest'
import { MeshRenderer } from './MeshRenderer'
import { MockGfxDevice } from './webgl2/mockGfxDevice'
import type { GfxBackend, RenderTarget } from './GfxDevice'
import { Camera3D } from '../../camera/Camera3D'
import { SceneTree } from '../../scene/SceneTree'
import { Node3D } from '../../scene/Node3D'
import { MeshNode, createBoxGeometry } from '../../nodes/MeshNode'

const TARGET = { format: 'linear' as const, samples: 1 }

async function untilReady(r: MeshRenderer): Promise<void> {
  for (let i = 0; i < 100 && !r.ready; i++) await Promise.resolve()
}

async function setup(backend: GfxBackend) {
  const device = new MockGfxDevice(backend)
  const renderer = new MeshRenderer(device, TARGET)
  await untilReady(renderer)
  const world = new SceneTree(new Node3D('world3d-root'))
  const camera = new Camera3D()
  camera.transform.setPosition(0, 0, 5)
  camera.setAspect(1)
  world.add(
    new MeshNode(createBoxGeometry(1), { lit: true, color: [1, 1, 1, 1] }),
  )
  world.add(
    new MeshNode(createBoxGeometry(1), { lit: true, color: [1, 1, 1, 1] }),
  )
  world.updateTransforms()
  const gbuf: RenderTarget = device.createRenderTarget({
    width: 64,
    height: 64,
    depth: true,
    depthSampled: true,
  })
  device.reset()
  return { device, renderer, world, camera, gbuf }
}

describe('MeshRenderer G-buffer prepass', () => {
  it('renders opaque meshes into the color + sampleable depth target', async () => {
    const { device, renderer, world, camera, gbuf } = await setup('webgpu')
    device.beginFrame()
    renderer.renderGBuffer(camera, world.root, gbuf)
    device.endFrame()

    // One pass targeting the G-buffer's color + its own depth attachment.
    const passes = device.passes.filter(
      (p) =>
        p.desc.color?.target === gbuf &&
        p.desc.depth?.target !== undefined &&
        'renderTarget' in p.desc.depth.target &&
        p.desc.depth.target.renderTarget === gbuf,
    )
    expect(passes).toHaveLength(1)

    // Both boxes drawn with the G-buffer pipeline (position + normal buffers).
    const gDraws = device.draws.filter(
      (d) => d.pipeline.desc.label === 'ao-gbuffer',
    )
    expect(gDraws).toHaveLength(2)
    for (const d of gDraws) {
      expect(d.kind).toBe('elements')
      expect(d.vertexBuffers).toHaveLength(2)
    }
    // The G-buffer pipeline is single-sample with a linear color target and
    // writes depth.
    const p = gDraws[0].pipeline.desc
    expect(p.samples).toBe(1)
    expect(p.color?.format).toBe('linear')
    expect(p.depth?.write).toBe(true)
  })

  it('is a no-op before pipelines warm', () => {
    const device = new MockGfxDevice('webgpu')
    const renderer = new MeshRenderer(device, TARGET)
    const world = new SceneTree(new Node3D('world3d-root'))
    world.add(
      new MeshNode(createBoxGeometry(1), { lit: true, color: [1, 1, 1, 1] }),
    )
    world.updateTransforms()
    const gbuf = device.createRenderTarget({
      width: 64,
      height: 64,
      depth: true,
    })
    device.reset()
    const camera = new Camera3D()
    // `ready` is still false synchronously after construction.
    renderer.renderGBuffer(camera, world.root, gbuf)
    expect(device.passes).toHaveLength(0)
    expect(device.draws).toHaveLength(0)
  })
})
