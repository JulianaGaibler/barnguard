import { describe, expect, it } from 'vitest'
import { MeshRenderer } from './MeshRenderer'
import { MockGfxDevice } from './webgl2/mockGfxDevice'
import type { GfxBackend } from './GfxDevice'
import { Camera3D } from '../../camera/Camera3D'
import { SceneTree } from '../../scene/SceneTree'
import { Node3D } from '../../scene/Node3D'
import { MeshNode, createBoxGeometry } from '../../nodes/MeshNode'
import { DirectionalLight3D } from '../../nodes/Light3D'
import { RenderQuality } from '../RenderQuality'

/**
 * Cross-backend coordinate conformance for the backend-neutral 3D code. It
 * renders one golden scene against a mock standing in for each backend and
 * asserts the coordinate parts that must differ per backend (clip-Z, shadow
 * reconciliation) and the parts that must stay the same (front-face winding,
 * depth, cull). `MockGfxDevice(backend)` reports that backend's real `ndc`, so
 * these run the same `device.ndc`-driven branches the live devices do.
 */

const TARGET = { format: 'linear' as const, samples: 1 }
const SHADOW_FRAME_BYTES = 272

async function untilReady(r: MeshRenderer): Promise<void> {
  for (let i = 0; i < 100 && !r.ready; i++) await Promise.resolve()
}

/** A PBR caster + a shadow-casting directional light, drawn on `backend`. */
async function renderGoldenScene(backend: GfxBackend) {
  const device = new MockGfxDevice(backend)
  const renderer = new MeshRenderer(device, TARGET, new RenderQuality())
  await untilReady(renderer)
  const world = new SceneTree(new Node3D('world3d-root'))
  const camera = new Camera3D()
  camera.transform.setPosition(0, 0, 5)
  camera.setAspect(1)

  world.add(
    new MeshNode(createBoxGeometry(1), {
      lit: true,
      color: [1, 1, 1, 1],
      pbr: true,
    }),
  )
  world.add(new DirectionalLight3D({ shadowEnabled: true }))
  world.updateTransforms()

  renderer.renderShadows(world.root)
  renderer.render(camera, world.root)
  return { device, camera }
}

/** The most recent shadow-frame UBO upload as a float view. */
function shadowFrame(device: MockGfxDevice): Float32Array {
  for (let i = device.uniformUploads.length - 1; i >= 0; i--) {
    const u = device.uniformUploads[i]
    if (u.data.byteLength === SHADOW_FRAME_BYTES)
      return new Float32Array(u.data.buffer, u.data.byteOffset, 68)
  }
  throw new Error('no shadow-frame upload')
}

describe('backend coordinate conformance', () => {
  it('camera projection uses the backend clip-Z range', async () => {
    const gl = await renderGoldenScene('webgl2')
    const gpu = await renderGoldenScene('webgpu')
    // The renderer drives the camera's clip-Z from `device.ndc`, so depth lands
    // in the range each backend keeps: WebGL clips `[-1,1]`, WebGPU `[0,1]`.
    expect(gl.camera.clipDepth).toBe('neg-one-to-one')
    expect(gpu.camera.clipDepth).toBe('zero-to-one')
  })

  it('3D pipelines keep ccw winding on both backends (cull parity)', async () => {
    // The winding does NOT flip between backends for this engine's setup: a
    // Z-only projection change leaves framebuffer-space winding alone, so both
    // declare `'ccw'`. Flipping it (a tempting "fix") culls the wrong faces.
    for (const backend of ['webgl2', 'webgpu'] as const) {
      const { device } = await renderGoldenScene(backend)
      const culled = device.pipelines.filter((p) => p.desc.cull !== 'none')
      expect(culled.length).toBeGreaterThan(0)
      for (const p of culled) expect(p.desc.frontFace).toBe('ccw')
    }
  })

  it('depth-tested 3D pipelines test depth on both backends', async () => {
    for (const backend of ['webgl2', 'webgpu'] as const) {
      const { device } = await renderGoldenScene(backend)
      const meshes = device.pipelines.filter(
        (p) => p.desc.color !== null && p.desc.cull === 'back',
      )
      expect(meshes.length).toBeGreaterThan(0)
      for (const p of meshes) expect(p.desc.depth?.test).toBe(true)
    }
  })

  it('shadow-sample reconciliation flags match the backend conventions', async () => {
    // mesh_pbr reconciles the light-space depth and the shadow-map row order
    // from these two flags: `.z` (word 66) = 1 when the light projection keeps
    // depth in `[0,1]`, `.w` (word 67) = 1 when the map is stored top-down.
    // Both hold on WebGPU, neither on WebGL2.
    const gl = shadowFrame((await renderGoldenScene('webgl2')).device)
    const gpu = shadowFrame((await renderGoldenScene('webgpu')).device)
    expect([gl[66], gl[67]]).toEqual([0, 0])
    expect([gpu[66], gpu[67]]).toEqual([1, 1])
  })
})

/**
 * The compute + gfx foundation is exercised end-to-end only in a real browser
 * (happy-dom has no GPU), so these check the backend-neutral contract against
 * the mock: which backend exposes compute, that a dispatch records into a
 * compute pass, that WebGL2 refuses compute, and that a sampleable-depth target
 * hands back a depth texture on both backends.
 */
describe('compute + gfx foundation contract', () => {
  it('exposes compute on WebGPU and not on WebGL2', () => {
    expect(new MockGfxDevice('webgpu').supportsCompute).toBe(true)
    expect(new MockGfxDevice('webgl2').supportsCompute).toBe(false)
  })

  it('records a compute dispatch inside a compute pass on WebGPU', async () => {
    const device = new MockGfxDevice('webgpu')
    const shader = device.createShaderModule({
      wgsl: { code: '', computeEntry: 'cs_main' },
      reflection: { attributes: [], uniformBlocks: [], samplers: [] },
    })
    const layout = device.createBindGroupLayout([
      { binding: 0, type: 'storage-texture-2d' },
    ])
    const pipeline = await device.createComputePipeline({
      shader,
      bindGroupLayouts: [layout],
    })
    const tex = device.createTexture2D({ width: 8, height: 8, storage: true })
    const bindGroup = device.createBindGroup(layout, [
      { binding: 0, resource: { texture: tex } },
    ])
    device.beginFrame()
    device.beginComputePass()
    device.dispatchCompute({
      pipeline,
      bindGroups: [{ group: 0, bindGroup }],
      x: 1,
      y: 2,
    })
    device.endComputePass()
    device.endFrame()
    expect(device.computePipelines).toHaveLength(1)
    expect(device.computePassBegins).toBe(1)
    expect(device.computePassEnds).toBe(1)
    expect(device.computeDispatches).toEqual([{ pipeline, x: 1, y: 2, z: 1 }])
  })

  it('refuses to create a compute pipeline on WebGL2', () => {
    const device = new MockGfxDevice('webgl2')
    const shader = device.createShaderModule({
      wgsl: { code: '', computeEntry: 'cs_main' },
      reflection: { attributes: [], uniformBlocks: [], samplers: [] },
    })
    expect(() =>
      device.createComputePipeline({ shader, bindGroupLayouts: [] }),
    ).toThrow(/compute/)
  })

  it('hands back a sampleable depth texture on both backends', () => {
    for (const backend of ['webgl2', 'webgpu'] as const) {
      const device = new MockGfxDevice(backend)
      const rt = device.createRenderTarget({
        width: 16,
        height: 16,
        depth: true,
        depthSampled: true,
      })
      // A depth-only target (no depthSampled) has no sampleable depth.
      const plain = device.createRenderTarget({
        width: 16,
        height: 16,
        depth: true,
      })
      expect(device.depthTexture(rt)).toBeDefined()
      expect(() => device.depthTexture(plain)).toThrow()
    }
  })
})
