import { describe, expect, it } from 'vitest'
import { MeshRenderer } from './MeshRenderer'
import { MockGfxDevice } from './webgl2/mockGfxDevice'
import { Camera3D } from '../../camera/Camera3D'
import { SceneTree } from '../../scene/SceneTree'
import { Node3D } from '../../scene/Node3D'
import { MeshNode, createBoxGeometry } from '../../nodes/MeshNode'
import {
  DirectionalLight3D,
  PointLight3D,
  SpotLight3D,
} from '../../nodes/Light3D'
import { RenderQuality } from '../RenderQuality'
import { Fog } from '../Fog'

const TARGET = { format: 'linear' as const, samples: 1 }

/** Drain microtasks until the renderer's pipelines have warmed. */
async function untilReady(r: MeshRenderer): Promise<void> {
  for (let i = 0; i < 100 && !r.ready; i++) await Promise.resolve()
}

async function setup(fog?: Fog) {
  const device = new MockGfxDevice()
  const renderer = new MeshRenderer(device, TARGET, new RenderQuality(), fog)
  await untilReady(renderer)
  const world = new SceneTree(new Node3D('world3d-root'))
  const camera = new Camera3D()
  camera.transform.setPosition(0, 0, 5)
  camera.setAspect(1)
  return { device, renderer, world, camera }
}

/**
 * The most recent per-frame UBO upload of the given byte size (FlatFrame=208,
 * PbrFrame=176).
 */
function frameUpload(device: MockGfxDevice, bytes: number): Float32Array {
  for (let i = device.uniformUploads.length - 1; i >= 0; i--) {
    const u = device.uniformUploads[i]
    if (u.data.byteLength === bytes)
      return new Float32Array(u.data.buffer, u.data.byteOffset, bytes / 4)
  }
  throw new Error(`no ${bytes}-byte uniform upload`)
}

/** Fog color (words 24..27) + params (28..31) within a mesh frame block. */
function frameFog(frame: Float32Array) {
  return { color: frame.subarray(24, 28), params: frame.subarray(28, 32) }
}

describe('MeshRenderer', () => {
  it('draws an uploaded mesh with depth test and back-face culling', async () => {
    const { device, renderer, world, camera } = await setup()
    const cube = new MeshNode(createBoxGeometry(1), {
      lit: true,
      color: [1, 0, 0, 1],
    })
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

  it('uploads a u16 index buffer for a small mesh', async () => {
    const { device, renderer, world, camera } = await setup()
    world.add(
      new MeshNode(createBoxGeometry(1), { lit: false, color: [1, 1, 1, 1] }),
    )
    world.updateTransforms()
    renderer.render(camera, world.root)
    expect(device.indexBufferTypes.at(-1)).toBe('u16')
  })

  it('skips a mesh whose geometry has not loaded yet', async () => {
    const { device, renderer, world, camera } = await setup()
    world.add(new MeshNode(null, { lit: false, color: [1, 1, 1, 1] }))
    world.updateTransforms()
    renderer.render(camera, world.root)
    expect(device.draws.filter((d) => d.kind === 'elements')).toHaveLength(0)
  })

  it('reuses the GPU upload across frames', async () => {
    const { device, renderer, world, camera } = await setup()
    world.add(
      new MeshNode(createBoxGeometry(1), { lit: true, color: [1, 1, 1, 1] }),
    )
    world.updateTransforms()
    renderer.render(camera, world.root)
    const buffersAfterFirst = device.buffers.length
    renderer.render(camera, world.root)
    // No new vertex buffers on the second frame — the mesh is cached.
    expect(device.buffers.length).toBe(buffersAfterFirst)
  })

  it('draws nothing for an empty world', async () => {
    const { device, renderer, world, camera } = await setup()
    world.updateTransforms()
    renderer.render(camera, world.root)
    expect(device.draws).toHaveLength(0)
  })

  it('re-warms color pipelines at the new sample count on retarget', async () => {
    const { device, renderer } = await setup()
    // Only the mesh color pipelines follow the main target's sample count; the
    // single-sample G-buffer/shadow pipelines render to their own targets and
    // are unaffected by retarget, so scope the assertion to `mesh-*`.
    const colorPipes = () =>
      device.pipelines.filter(
        (p) => p.desc.color !== null && p.desc.label?.startsWith('mesh-'),
      )
    expect(colorPipes().every((p) => p.desc.samples === 1)).toBe(true)

    renderer.retarget({ format: 'linear', samples: 4 })
    expect(renderer.ready).toBe(false)
    await untilReady(renderer)

    // The pipelines drawn after re-warm bake the new count. (Older 1-sample
    // handles remain recorded on the mock; the map now points at the 4-sample
    // ones, so the latest color pipeline created carries samples 4.)
    const latest = colorPipes().at(-1)
    expect(latest?.desc.samples).toBe(4)
  })

  it('retarget is a no-op when the target color is unchanged', async () => {
    const { device, renderer } = await setup()
    const before = device.pipelines.length
    renderer.retarget({ format: 'linear', samples: 1 })
    expect(renderer.ready).toBe(true)
    expect(device.pipelines.length).toBe(before)
  })

  it('draws a pbr material through the PBR program', async () => {
    const { device, renderer, world, camera } = await setup()
    const geo = createBoxGeometry(1)
    const verts = geo.positions.length / 3
    geo.uvs = new Float32Array(verts * 2)
    geo.tangents = new Float32Array(verts * 4)
    world.add(
      new MeshNode(geo, {
        lit: true,
        color: [1, 1, 1, 1],
        pbr: true,
        metallicFactor: 0,
        roughnessFactor: 0.5,
      }),
    )
    world.updateTransforms()
    renderer.render(camera, world.root)
    expect(device.draws.filter((d) => d.kind === 'elements')).toHaveLength(1)
    expect(renderer.stats.draws).toBe(1)
  })

  it('draws flat and pbr meshes together (two programs in one frame)', async () => {
    const { device, renderer, world, camera } = await setup()
    world.add(
      new MeshNode(createBoxGeometry(1), { lit: true, color: [1, 0, 0, 1] }),
    )
    const geo = createBoxGeometry(1)
    geo.uvs = new Float32Array((geo.positions.length / 3) * 2)
    const pbr = new MeshNode(geo, { lit: true, color: [0, 1, 0, 1], pbr: true })
    pbr.transform.setPosition(2, 0, 0)
    world.add(pbr)
    world.updateTransforms()
    renderer.render(camera, world.root)
    expect(device.draws.filter((d) => d.kind === 'elements')).toHaveLength(2)
  })

  it('draws the opaque bucket before the transparent bucket, ignoring depth order', async () => {
    const { device, renderer, world, camera } = await setup()
    const opaque = new MeshNode(createBoxGeometry(1), {
      lit: true,
      color: [1, 0, 0, 1],
    })
    opaque.transform.setPosition(0, 0, -10)
    world.add(opaque)
    const tri = {
      positions: new Float32Array([0, 0, 0, 1, 0, 0, 0, 1, 0]),
      normals: new Float32Array([0, 0, 1, 0, 0, 1, 0, 0, 1]),
      indices: new Uint16Array([0, 1, 2]),
    }
    const blend = new MeshNode(tri, {
      lit: true,
      color: [0, 1, 0, 0.5],
      pbr: true,
      alphaMode: 'BLEND',
    })
    blend.transform.setPosition(0, 0, 2)
    world.add(blend)
    world.updateTransforms()
    renderer.render(camera, world.root)
    const el = device.draws.filter((d) => d.kind === 'elements')
    expect(el).toHaveLength(2)
    expect(el[0].count).toBe(36) // opaque box first
    expect(el[1].count).toBe(3) // transparent triangle second
  })

  it('disables back-face culling for a double-sided material', async () => {
    const { device, renderer, world, camera } = await setup()
    world.add(
      new MeshNode(createBoxGeometry(1), {
        lit: true,
        color: [1, 1, 1, 1],
        pbr: true,
        doubleSided: true,
      }),
    )
    world.updateTransforms()
    renderer.render(camera, world.root)
    expect(device.cull).toBe('none')
  })

  it('keeps back-face culling for a single-sided material', async () => {
    const { device, renderer, world, camera } = await setup()
    world.add(
      new MeshNode(createBoxGeometry(1), {
        lit: true,
        color: [1, 1, 1, 1],
        pbr: true,
      }),
    )
    world.updateTransforms()
    renderer.render(camera, world.root)
    expect(device.cull).toBe('back')
  })

  it('draws a pbr mesh lit by a scene light node', async () => {
    const { device, renderer, world, camera } = await setup()
    const geo = createBoxGeometry(1)
    geo.uvs = new Float32Array((geo.positions.length / 3) * 2)
    world.add(new MeshNode(geo, { lit: true, color: [1, 1, 1, 1], pbr: true }))
    const light = new PointLight3D({ color: [1, 0, 0], intensity: 1 })
    light.transform.setPosition(0, 3, 0)
    world.add(light)
    world.updateTransforms()
    expect(() => renderer.render(camera, world.root)).not.toThrow()
    expect(device.draws.filter((d) => d.kind === 'elements')).toHaveLength(1)
  })

  it('renders a lights-only scene without drawing anything', async () => {
    const { device, renderer, world, camera } = await setup()
    world.add(new DirectionalLight3D())
    world.updateTransforms()
    expect(() => renderer.render(camera, world.root)).not.toThrow()
    expect(device.draws).toHaveLength(0)
  })

  it('renders a directional shadow layer for a shadow-casting light', async () => {
    const { device, renderer, world, camera } = await setup()
    const caster = new MeshNode(createBoxGeometry(1), {
      lit: true,
      color: [1, 1, 1, 1],
      pbr: true,
    })
    world.add(caster)
    world.add(new DirectionalLight3D({ shadowEnabled: true }))
    world.updateTransforms()

    renderer.renderShadows(world.root)
    expect(device.shadowArrays).toHaveLength(1)
    expect(device.shadowLayerBegins).toEqual([0])
    expect(device.shadowPassEnds).toBe(1)
    // The caster drew into the shadow map (depth pass).
    expect(device.draws.filter((d) => d.kind === 'elements')).toHaveLength(1)

    // The main pass draws the caster too.
    renderer.render(camera, world.root)
    expect(device.draws.filter((d) => d.kind === 'elements')).toHaveLength(2)
  })

  it('renders a spot shadow into a depth-array layer', async () => {
    const { device, renderer, world } = await setup()
    world.add(
      new MeshNode(createBoxGeometry(1), {
        lit: true,
        color: [1, 1, 1, 1],
        pbr: true,
      }),
    )
    const spot = new SpotLight3D({
      shadowEnabled: true,
      range: 10,
      outerConeAngle: 0.6,
    })
    spot.transform.setPosition(0, 5, 0)
    world.add(spot)
    world.updateTransforms()

    renderer.renderShadows(world.root)
    expect(device.shadowLayerBegins).toEqual([0])
    expect(device.shadowArrays).toHaveLength(1)
  })

  it('renders six cube faces for one shadow-casting point light', async () => {
    const { device, renderer, world } = await setup()
    world.add(
      new MeshNode(createBoxGeometry(1), {
        lit: true,
        color: [1, 1, 1, 1],
        pbr: true,
      }),
    )
    const a = new PointLight3D({ shadowEnabled: true, range: 12 })
    a.transform.setPosition(0, 4, 0)
    world.add(a)
    const b = new PointLight3D({ shadowEnabled: true, range: 12 })
    b.transform.setPosition(3, 4, 0)
    world.add(b)
    world.updateTransforms()

    renderer.renderShadows(world.root)
    expect(device.shadowCubes).toHaveLength(1)
    expect(device.shadowCubeFaceBegins).toEqual([0, 1, 2, 3, 4, 5])
  })

  it('skips the shadow pass when quality.shadowsEnabled is off', async () => {
    const device = new MockGfxDevice()
    const quality = new RenderQuality({ shadowsEnabled: false })
    const renderer = new MeshRenderer(device, TARGET, quality)
    await untilReady(renderer)
    const world = new SceneTree(new Node3D('world3d-root'))
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
    expect(device.shadowLayerBegins).toEqual([])
    expect(device.shadowArrays).toHaveLength(0)
  })

  it('exposes bound material textures to the debug inspector', async () => {
    const { renderer, world, camera } = await setup()
    expect(renderer.textureInspector).toBeNull()

    const geo = createBoxGeometry(1)
    geo.uvs = new Float32Array((geo.positions.length / 3) * 2)
    const image = {
      bytes: new Uint8Array([1, 2, 3]),
      mimeType: 'image/png',
      bitmap: { width: 8, height: 8, close() {} } as unknown as ImageBitmap,
    }
    world.add(
      new MeshNode(geo, {
        lit: true,
        color: [1, 1, 1, 1],
        pbr: true,
        baseColorTex: {
          image,
          sampler: { wrap: 'repeat', mipmap: true },
          srgb: true,
        },
      }),
    )
    world.updateTransforms()
    renderer.render(camera, world.root)

    const inspector = renderer.textureInspector
    expect(inspector).not.toBeNull()
    const snap = inspector!.snapshot()
    expect(snap.atlas.capacity).toBe(0)
    expect(snap.labelCap).toBe(0)
    expect(inspector!.renderLabelPreview('anything')).toBeNull()
  })

  it('skips the shadow pass when no light casts', async () => {
    const { device, renderer, world } = await setup()
    world.add(
      new MeshNode(createBoxGeometry(1), {
        lit: true,
        color: [1, 1, 1, 1],
        pbr: true,
      }),
    )
    world.add(new DirectionalLight3D()) // shadowEnabled defaults false
    world.updateTransforms()

    renderer.renderShadows(world.root)
    expect(device.shadowLayerBegins).toEqual([])
    expect(device.shadowArrays).toHaveLength(0)
    expect(device.shadowPassEnds).toBe(0)
  })

  it('uploads a disabled fog enable flag by default', async () => {
    const { device, renderer, world, camera } = await setup()
    world.add(
      new MeshNode(createBoxGeometry(1), { lit: true, color: [1, 1, 1, 1] }),
    )
    world.updateTransforms()
    renderer.render(camera, world.root)

    const { color } = frameFog(frameUpload(device, 208)) // FlatFrame
    expect(color[3]).toBe(0) // w = enable flag
  })

  it('uploads enabled exponential fog to the flat program', async () => {
    const fog = new Fog({ enabled: true, color: [0.2, 0.4, 0.6], density: 0.1 })
    const { device, renderer, world, camera } = await setup(fog)
    world.add(
      new MeshNode(createBoxGeometry(1), { lit: true, color: [1, 1, 1, 1] }),
    )
    world.updateTransforms()
    renderer.render(camera, world.root)

    const { color, params } = frameFog(frameUpload(device, 208)) // FlatFrame
    expect(color[0]).toBeCloseTo(0.2)
    expect(color[1]).toBeCloseTo(0.4)
    expect(color[2]).toBeCloseTo(0.6)
    expect(color[3]).toBe(1) // enabled
    expect(params[0]).toBe(0) // exp mode
    expect(params[1]).toBeCloseTo(0.1) // density
  })

  it('uploads linear fog params to the PBR program', async () => {
    const fog = new Fog({ enabled: true, mode: 'linear', start: 3, end: 12 })
    const { device, renderer, world, camera } = await setup(fog)
    const geo = createBoxGeometry(1)
    const verts = geo.positions.length / 3
    geo.uvs = new Float32Array(verts * 2)
    world.add(new MeshNode(geo, { lit: true, color: [1, 1, 1, 1], pbr: true }))
    world.updateTransforms()
    renderer.render(camera, world.root)

    const { color, params } = frameFog(frameUpload(device, 176)) // PbrFrame
    expect(color[3]).toBe(1)
    expect(params[0]).toBe(1) // linear mode
    expect(params[2]).toBe(3) // start
    expect(params[3]).toBe(12) // end
  })
})
