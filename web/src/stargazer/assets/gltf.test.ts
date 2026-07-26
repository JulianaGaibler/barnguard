import { describe, expect, it } from 'vitest'
import { parseGltf } from './gltf'
import { MeshNode } from '../nodes/MeshNode'
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
    meshes: [{ primitives: [{ attributes: { POSITION: 0 }, indices: 1, material: 0 }] }],
    materials: [{ pbrMetallicRoughness: { baseColorFactor: [1, 0, 0, 1] as [number, number, number, number] } }],
    accessors: [
      { bufferView: 0, componentType: 5126, count: 3, type: 'VEC3' },
      { bufferView: 1, componentType: 5123, count: 3, type: 'SCALAR' },
    ],
    bufferViews: [
      { buffer: 0, byteOffset: 0, byteLength: positions.byteLength },
      { buffer: 0, byteOffset: positions.byteLength, byteLength: indices.byteLength },
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
