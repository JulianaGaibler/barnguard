import { describe, expect, it } from 'vitest'
import { parseGltf } from './gltf'
import { MeshNode } from '../nodes/MeshNode'
import { PointLight3D } from '../nodes/Light3D'
import { AnimationPlayer } from '../anim/AnimationPlayer'
import type { Node3D } from '../scene/Node3D'
import { mat4TransformPoint } from '../math/Mat4'
import { vec3 } from '../math/Vec3'

/** Build a one-triangle glTF document + backing buffer for the parser. */
function triangleDoc() {
  const positions = new Float32Array([0, 0, 0, 1, 0, 0, 0, 1, 0])
  const indices = new Uint16Array([0, 1, 2])
  const buffer = new ArrayBuffer(positions.byteLength + indices.byteLength)
  new Float32Array(buffer, 0, 9).set(positions)
  new Uint16Array(buffer, positions.byteLength, 3).set(indices)
  const doc = {
    scene: 0,
    scenes: [{ nodes: [0] }],
    nodes: [{ mesh: 0, translation: [5, 0, 0] as [number, number, number] }],
    meshes: [
      {
        primitives: [{ attributes: { POSITION: 0 }, indices: 1, material: 0 }],
      },
    ],
    materials: [
      {
        pbrMetallicRoughness: {
          baseColorFactor: [1, 0, 0, 1] as [number, number, number, number],
        },
      },
    ],
    accessors: [
      { bufferView: 0, componentType: 5126, count: 3, type: 'VEC3' },
      { bufferView: 1, componentType: 5123, count: 3, type: 'SCALAR' },
    ],
    bufferViews: [
      { buffer: 0, byteOffset: 0, byteLength: positions.byteLength },
      {
        buffer: 0,
        byteOffset: positions.byteLength,
        byteLength: indices.byteLength,
      },
    ],
    buffers: [{ byteLength: buffer.byteLength }],
  }
  return { doc, buffer }
}

describe('parseGltf', () => {
  it('builds a node hierarchy with a mesh child', () => {
    const { doc, buffer } = triangleDoc()
    const root = parseGltf(doc, [buffer])
    expect(root.children).toHaveLength(1)
    const node = root.children[0]
    const mesh = node.children[0]
    expect(mesh).toBeInstanceOf(MeshNode)
  })

  it('reads positions and generates normals', () => {
    const { doc, buffer } = triangleDoc()
    const mesh = parseGltf(doc, [buffer]).children[0].children[0] as MeshNode
    expect(mesh.geometry?.positions).toHaveLength(9)
    expect(mesh.geometry?.indices).toHaveLength(3)
    expect(mesh.geometry?.normals).toHaveLength(9)
    // The triangle lies in the z=0 plane, so its normal points along ±z.
    const n = mesh.geometry!.normals
    expect(Math.abs(n[2])).toBeCloseTo(1, 5)
  })

  it('applies node translation to the transform', () => {
    const { doc, buffer } = triangleDoc()
    const node = parseGltf(doc, [buffer]).children[0] as Node3D
    node.ensureWorldTransform()
    const p = mat4TransformPoint(vec3(), node.worldMatrix, 0, 0, 0)
    expect(p.x).toBeCloseTo(5, 5)
  })

  it('carries the base-color factor into the material', () => {
    const { doc, buffer } = triangleDoc()
    const mesh = parseGltf(doc, [buffer]).children[0].children[0] as MeshNode
    expect(mesh.material.color).toEqual([1, 0, 0, 1])
    expect(mesh.material.lit).toBe(true)
  })
})

/**
 * A one-triangle glTF with TEXCOORD_0, two embedded images (a color image and a
 * packed occlusion-metallic-roughness image), a CLAMP sampler, and a metallic-
 * roughness material that uses the ORM image for both metallic-roughness and
 * occlusion (the RapidPipeline packing the fridge uses).
 */
function texturedDoc() {
  const positions = new Float32Array([0, 0, 0, 1, 0, 0, 0, 1, 0])
  const uvs = new Float32Array([0, 0, 1, 0, 0, 1])
  const indices = new Uint16Array([0, 1, 2])
  const imgBytes = new Uint8Array([1, 2, 3, 4, 5, 6, 7, 8]) // opaque to the parser
  const posLen = positions.byteLength
  const uvLen = uvs.byteLength
  const idxLen = indices.byteLength
  const buffer = new ArrayBuffer(posLen + uvLen + idxLen + imgBytes.byteLength)
  new Float32Array(buffer, 0, 9).set(positions)
  new Float32Array(buffer, posLen, 6).set(uvs)
  new Uint16Array(buffer, posLen + uvLen, 3).set(indices)
  new Uint8Array(buffer, posLen + uvLen + idxLen, 8).set(imgBytes)
  const doc = {
    scene: 0,
    scenes: [{ nodes: [0] }],
    nodes: [{ mesh: 0 }],
    meshes: [
      {
        primitives: [
          {
            attributes: { POSITION: 0, TEXCOORD_0: 1 },
            indices: 2,
            material: 0,
          },
        ],
      },
    ],
    materials: [
      {
        pbrMetallicRoughness: {
          baseColorTexture: { index: 0 },
          metallicRoughnessTexture: { index: 1 },
          metallicFactor: 0,
          roughnessFactor: 0.75,
        },
        occlusionTexture: { index: 1, strength: 0.5 },
        normalTexture: { index: 1, scale: 2 },
        emissiveTexture: { index: 0 },
        emissiveFactor: [1, 1, 1] as [number, number, number],
        alphaMode: 'MASK' as const,
        alphaCutoff: 0.25,
        doubleSided: true,
        extensions: {
          KHR_materials_diffuse_transmission: {
            diffuseTransmissionFactor: 0.1,
          },
        },
      },
    ],
    textures: [
      { source: 0, sampler: 0 },
      { source: 1, sampler: 0 },
    ],
    samplers: [{ wrapS: 33071, wrapT: 33071 }],
    images: [
      { bufferView: 3, mimeType: 'image/png' },
      { bufferView: 3, mimeType: 'image/jpeg' },
    ],
    accessors: [
      { bufferView: 0, componentType: 5126, count: 3, type: 'VEC3' },
      { bufferView: 1, componentType: 5126, count: 3, type: 'VEC2' },
      { bufferView: 2, componentType: 5123, count: 3, type: 'SCALAR' },
    ],
    bufferViews: [
      { buffer: 0, byteOffset: 0, byteLength: posLen },
      { buffer: 0, byteOffset: posLen, byteLength: uvLen },
      { buffer: 0, byteOffset: posLen + uvLen, byteLength: idxLen },
      { buffer: 0, byteOffset: posLen + uvLen + idxLen, byteLength: 8 },
    ],
    buffers: [{ byteLength: buffer.byteLength }],
  }
  return { doc, buffer }
}

describe('parseGltf materials', () => {
  it('reads TEXCOORD_0 into the geometry', () => {
    const { doc, buffer } = texturedDoc()
    const mesh = parseGltf(doc, [buffer]).children[0].children[0] as MeshNode
    expect(mesh.geometry?.uvs).toHaveLength(6)
  })

  it('flags base-color and emissive sRGB, and normal/MR/occlusion linear', () => {
    const { doc, buffer } = texturedDoc()
    const m = (parseGltf(doc, [buffer]).children[0].children[0] as MeshNode)
      .material
    expect(m.pbr).toBe(true)
    expect(m.baseColorTex?.srgb).toBe(true)
    expect(m.emissiveTex?.srgb).toBe(true)
    expect(m.metalRoughTex?.srgb).toBe(false)
    expect(m.normalTex?.srgb).toBe(false)
    expect(m.occlusionTex?.srgb).toBe(false)
  })

  it('shares one image instance for packed occlusion + metallic-roughness (ORM)', () => {
    const { doc, buffer } = texturedDoc()
    const m = (parseGltf(doc, [buffer]).children[0].children[0] as MeshNode)
      .material
    // occlusion + metallic-roughness reference the same glTF image → same
    // TextureImage instance, so the renderer uploads it once.
    expect(m.occlusionTex?.image).toBe(m.metalRoughTex?.image)
    // base color is a different image.
    expect(m.baseColorTex?.image).not.toBe(m.metalRoughTex?.image)
  })

  it('resolves sampler wrap + mip defaults, and forces MASK albedo non-mipmapped', () => {
    const { doc, buffer } = texturedDoc()
    const m = (parseGltf(doc, [buffer]).children[0].children[0] as MeshNode)
      .material
    expect(m.metalRoughTex?.sampler.wrap).toBe('clamp')
    // No minFilter on the sampler ⇒ trilinear (mips) by default…
    expect(m.metalRoughTex?.sampler.mipmap).toBe(true)
    // …except alpha-MASK albedo, which must stay crisp.
    expect(m.baseColorTex?.sampler.mipmap).toBe(false)
  })

  it('carries PBR factors, alpha, double-sidedness, and diffuse transmission', () => {
    const { doc, buffer } = texturedDoc()
    const m = (parseGltf(doc, [buffer]).children[0].children[0] as MeshNode)
      .material
    expect(m.metallicFactor).toBe(0)
    expect(m.roughnessFactor).toBe(0.75)
    expect(m.occlusionStrength).toBe(0.5)
    expect(m.normalScale).toBe(2)
    expect(m.alphaMode).toBe('MASK')
    expect(m.alphaCutoff).toBe(0.25)
    expect(m.doubleSided).toBe(true)
    expect(m.diffuseTransmission).toBeCloseTo(0.1, 5)
  })

  it('imports a KHR_lights_punctual point light as a PointLight3D child', () => {
    const doc = {
      scene: 0,
      scenes: [{ nodes: [0] }],
      nodes: [
        {
          translation: [1, 2, 3] as [number, number, number],
          extensions: { KHR_lights_punctual: { light: 0 } },
        },
      ],
      extensions: {
        KHR_lights_punctual: {
          lights: [
            { type: 'point', color: [0.8, 1, 0.5], intensity: 0.05, range: 2 },
          ],
        },
      },
    }
    const node = parseGltf(doc, []).children[0] as Node3D
    const light = node.children[0]
    expect(light).toBeInstanceOf(PointLight3D)
    const pl = light as PointLight3D
    expect(pl.color).toEqual([0.8, 1, 0.5])
    expect(pl.intensity).toBeCloseTo(0.05, 5)
    expect(pl.range).toBe(2)
    // Rides the node's transform.
    node.ensureWorldTransform()
    expect(pl.worldMatrix[12]).toBeCloseTo(1, 5)
    expect(pl.worldMatrix[14]).toBeCloseTo(3, 5)
  })

  it('builds an auto-playing AnimationPlayer that drives its target node', () => {
    const times = new Float32Array([0, 1])
    const values = new Float32Array([0, 0, 0, 4, 0, 0]) // x: 0 → 4
    const buffer = new ArrayBuffer(times.byteLength + values.byteLength)
    new Float32Array(buffer, 0, 2).set(times)
    new Float32Array(buffer, times.byteLength, 6).set(values)
    const doc = {
      scene: 0,
      scenes: [{ nodes: [0] }],
      nodes: [{}],
      animations: [
        {
          channels: [{ sampler: 0, target: { node: 0, path: 'translation' } }],
          samplers: [{ input: 0, output: 1, interpolation: 'LINEAR' }],
        },
      ],
      accessors: [
        { bufferView: 0, componentType: 5126, count: 2, type: 'SCALAR' },
        { bufferView: 1, componentType: 5126, count: 2, type: 'VEC3' },
      ],
      bufferViews: [
        { buffer: 0, byteOffset: 0, byteLength: times.byteLength },
        {
          buffer: 0,
          byteOffset: times.byteLength,
          byteLength: values.byteLength,
        },
      ],
      buffers: [{ byteLength: buffer.byteLength }],
    }
    const root = parseGltf(doc, [buffer])
    const player = root.children.find(
      (c) => c instanceof AnimationPlayer,
    ) as AnimationPlayer
    expect(player).toBeInstanceOf(AnimationPlayer)
    expect(player.clip?.duration).toBe(1)
    const node = root.children[0] as Node3D // glTF node 0, the animation target
    player.onUpdate(0.5)
    expect(node.transform.position.x).toBeCloseTo(2, 5)
  })

  it('degrades KHR_materials_transmission glass to a translucent blend', () => {
    const { doc, buffer } = triangleDoc()
    // Default white opaque glass; transmission must make it see-through, not a
    // solid slab (alpha well below 1).
    doc.materials = [
      {
        pbrMetallicRoughness: {
          baseColorFactor: [1, 1, 1, 1] as [number, number, number, number],
        },
        extensions: { KHR_materials_transmission: { transmissionFactor: 1 } },
      },
    ] as unknown as typeof doc.materials
    const m = (parseGltf(doc, [buffer]).children[0].children[0] as MeshNode)
      .material
    expect(m.alphaMode).toBe('BLEND')
    expect(m.color[3]).toBeCloseTo(0.25, 5)
  })
})
