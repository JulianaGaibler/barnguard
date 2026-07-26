import { Node3D } from '../scene/Node3D'
import { MeshNode, type MeshGeometry, type MeshMaterial } from '../nodes/MeshNode'

/**
 * Loads glTF 2.0 models into a {@link Node3D} hierarchy for the 3D pass.
 *
 * `loadGltf(url)` fetches a `.gltf` (JSON, with external or data-URI buffers) or
 * a `.glb` (binary container) and returns the scene root. `parseGltf(json,
 * buffers)` is the pure core: hand it a parsed glTF object and its resolved
 * binary buffers and it builds the tree, for tests or custom loaders.
 *
 * Scope: mesh geometry (POSITION, NORMAL, `TRIANGLES`, 16- and 32-bit indices),
 * the node hierarchy with TRS or matrix transforms, and the material base-color
 * factor as a flat lit color. Missing normals are computed (smooth). Textures,
 * skinning, morph targets, and animations are not read yet. The world is y-up
 * right-handed, matching glTF, so no axis conversion happens.
 *
 * @category Assets
 * @example
 *   const model = await loadGltf('/models/robot.glb')
 *   engine.tree.add(model)
 */

interface GltfAccessor {
  bufferView?: number
  byteOffset?: number
  componentType: number
  count: number
  type: 'SCALAR' | 'VEC2' | 'VEC3' | 'VEC4' | string
}

interface GltfBufferView {
  buffer: number
  byteOffset?: number
  byteLength: number
  byteStride?: number
}

interface GltfPrimitive {
  attributes: Record<string, number>
  indices?: number
  material?: number
  mode?: number
}

interface GltfMesh {
  primitives: GltfPrimitive[]
}

interface GltfNode {
  mesh?: number
  children?: number[]
  name?: string
  translation?: [number, number, number]
  rotation?: [number, number, number, number]
  scale?: [number, number, number]
  matrix?: number[]
}

interface GltfMaterial {
  pbrMetallicRoughness?: { baseColorFactor?: [number, number, number, number] }
}

interface GltfDoc {
  scene?: number
  scenes?: { nodes?: number[] }[]
  nodes?: GltfNode[]
  meshes?: GltfMesh[]
  accessors?: GltfAccessor[]
  bufferViews?: GltfBufferView[]
  buffers?: { uri?: string; byteLength: number }[]
  materials?: GltfMaterial[]
}

const COMPONENT = {
  UNSIGNED_BYTE: 5121,
  UNSIGNED_SHORT: 5123,
  UNSIGNED_INT: 5125,
  FLOAT: 5126,
}
const COMPONENTS_PER_TYPE: Record<string, number> = {
  SCALAR: 1,
  VEC2: 2,
  VEC3: 3,
  VEC4: 4,
}

/** Read an accessor's floats, honoring the buffer view's optional interleave stride. */
function readFloats(doc: GltfDoc, buffers: ArrayBuffer[], accessorIndex: number): Float32Array {
  const acc = doc.accessors![accessorIndex]
  const comps = COMPONENTS_PER_TYPE[acc.type] ?? 1
  const out = new Float32Array(acc.count * comps)
  if (acc.bufferView === undefined) return out // sparse-only accessor: zeros
  const view = doc.bufferViews![acc.bufferView]
  const buffer = buffers[view.buffer]
  const base = (view.byteOffset ?? 0) + (acc.byteOffset ?? 0)
  const stride = view.byteStride ?? comps * 4
  const dv = new DataView(buffer)
  for (let i = 0; i < acc.count; i++) {
    const elem = base + i * stride
    for (let c = 0; c < comps; c++) out[i * comps + c] = dv.getFloat32(elem + c * 4, true)
  }
  return out
}

/** Read an index accessor into the narrowest typed array that fits the component type. */
function readIndices(
  doc: GltfDoc,
  buffers: ArrayBuffer[],
  accessorIndex: number,
): Uint16Array | Uint32Array {
  const acc = doc.accessors![accessorIndex]
  const view = doc.bufferViews![acc.bufferView!]
  const buffer = buffers[view.buffer]
  const base = (view.byteOffset ?? 0) + (acc.byteOffset ?? 0)
  const dv = new DataView(buffer)
  const out =
    acc.componentType === COMPONENT.UNSIGNED_INT
      ? new Uint32Array(acc.count)
      : new Uint16Array(acc.count)
  for (let i = 0; i < acc.count; i++) {
    if (acc.componentType === COMPONENT.UNSIGNED_INT) out[i] = dv.getUint32(base + i * 4, true)
    else if (acc.componentType === COMPONENT.UNSIGNED_SHORT) out[i] = dv.getUint16(base + i * 2, true)
    else out[i] = dv.getUint8(base + i) // UNSIGNED_BYTE
  }
  return out
}

/** Smooth per-vertex normals from positions + indices, for meshes lacking NORMAL. */
function computeNormals(positions: Float32Array, indices: Uint16Array | Uint32Array): Float32Array {
  const normals = new Float32Array(positions.length)
  for (let t = 0; t < indices.length; t += 3) {
    const ia = indices[t] * 3
    const ib = indices[t + 1] * 3
    const ic = indices[t + 2] * 3
    const ax = positions[ia], ay = positions[ia + 1], az = positions[ia + 2]
    const bx = positions[ib], by = positions[ib + 1], bz = positions[ib + 2]
    const cx = positions[ic], cy = positions[ic + 1], cz = positions[ic + 2]
    const e1x = bx - ax, e1y = by - ay, e1z = bz - az
    const e2x = cx - ax, e2y = cy - ay, e2z = cz - az
    const nx = e1y * e2z - e1z * e2y
    const ny = e1z * e2x - e1x * e2z
    const nz = e1x * e2y - e1y * e2x
    for (const base of [ia, ib, ic]) {
      normals[base] += nx
      normals[base + 1] += ny
      normals[base + 2] += nz
    }
  }
  for (let i = 0; i < normals.length; i += 3) {
    const len = Math.hypot(normals[i], normals[i + 1], normals[i + 2]) || 1
    normals[i] /= len
    normals[i + 1] /= len
    normals[i + 2] /= len
  }
  return normals
}

function materialFor(doc: GltfDoc, index: number | undefined): MeshMaterial {
  const factor = index !== undefined
    ? doc.materials?.[index]?.pbrMetallicRoughness?.baseColorFactor
    : undefined
  return { lit: true, color: factor ? [...factor] : [0.8, 0.8, 0.8, 1] }
}

function geometryFor(
  doc: GltfDoc,
  buffers: ArrayBuffer[],
  prim: GltfPrimitive,
): MeshGeometry | null {
  const posIdx = prim.attributes.POSITION
  if (posIdx === undefined) return null
  const positions = readFloats(doc, buffers, posIdx)
  const indices = prim.indices !== undefined
    ? readIndices(doc, buffers, prim.indices)
    : sequentialIndices(positions.length / 3)
  const normals = prim.attributes.NORMAL !== undefined
    ? readFloats(doc, buffers, prim.attributes.NORMAL)
    : computeNormals(positions, indices)
  return { positions, normals, indices }
}

function sequentialIndices(vertexCount: number): Uint16Array | Uint32Array {
  const out = vertexCount > 65535 ? new Uint32Array(vertexCount) : new Uint16Array(vertexCount)
  for (let i = 0; i < vertexCount; i++) out[i] = i
  return out
}

function buildNode(doc: GltfDoc, buffers: ArrayBuffer[], index: number): Node3D {
  const gnode = doc.nodes![index]
  const node = new Node3D(gnode.name ?? `gltf-node-${index}`)
  applyTransform(node, gnode)
  if (gnode.mesh !== undefined) {
    const mesh = doc.meshes![gnode.mesh]
    for (const prim of mesh.primitives) {
      if (prim.mode !== undefined && prim.mode !== 4) continue // TRIANGLES only
      const geom = geometryFor(doc, buffers, prim)
      if (geom) node.add(new MeshNode(geom, materialFor(doc, prim.material)))
    }
  }
  for (const child of gnode.children ?? []) node.add(buildNode(doc, buffers, child))
  return node
}

function applyTransform(node: Node3D, gnode: GltfNode): void {
  if (gnode.matrix) {
    decomposeMatrix(node, gnode.matrix)
    return
  }
  const t = gnode.translation
  if (t) node.transform.setPosition(t[0], t[1], t[2])
  const r = gnode.rotation
  if (r) node.transform.setRotation(r[0], r[1], r[2], r[3])
  const s = gnode.scale
  if (s) node.transform.setScale(s[0], s[1], s[2])
}

/** Decompose a column-major 4x4 into TRS and apply to `node`'s transform. */
function decomposeMatrix(node: Node3D, m: number[]): void {
  const tx = m[12], ty = m[13], tz = m[14]
  let sx = Math.hypot(m[0], m[1], m[2])
  const sy = Math.hypot(m[4], m[5], m[6])
  const sz = Math.hypot(m[8], m[9], m[10])
  const det = m[0] * (m[5] * m[10] - m[6] * m[9]) -
    m[4] * (m[1] * m[10] - m[2] * m[9]) +
    m[8] * (m[1] * m[6] - m[2] * m[5])
  if (det < 0) sx = -sx
  const r00 = m[0] / sx, r01 = m[4] / sy, r02 = m[8] / sz
  const r10 = m[1] / sx, r11 = m[5] / sy, r12 = m[9] / sz
  const r20 = m[2] / sx, r21 = m[6] / sy, r22 = m[10] / sz
  // Rotation matrix → quaternion.
  const trace = r00 + r11 + r22
  let qx: number, qy: number, qz: number, qw: number
  if (trace > 0) {
    const s = Math.sqrt(trace + 1) * 2
    qw = 0.25 * s
    qx = (r21 - r12) / s
    qy = (r02 - r20) / s
    qz = (r10 - r01) / s
  } else if (r00 > r11 && r00 > r22) {
    const s = Math.sqrt(1 + r00 - r11 - r22) * 2
    qw = (r21 - r12) / s
    qx = 0.25 * s
    qy = (r01 + r10) / s
    qz = (r02 + r20) / s
  } else if (r11 > r22) {
    const s = Math.sqrt(1 + r11 - r00 - r22) * 2
    qw = (r02 - r20) / s
    qx = (r01 + r10) / s
    qy = 0.25 * s
    qz = (r12 + r21) / s
  } else {
    const s = Math.sqrt(1 + r22 - r00 - r11) * 2
    qw = (r10 - r01) / s
    qx = (r02 + r20) / s
    qy = (r12 + r21) / s
    qz = 0.25 * s
  }
  node.transform.setPosition(tx, ty, tz)
  node.transform.setRotation(qx, qy, qz, qw)
  node.transform.setScale(sx, sy, sz)
}

/**
 * Build the {@link Node3D} tree from an already-parsed glTF document and its
 * resolved binary buffers. Pure and synchronous. Returns a root node holding the
 * default scene's top-level nodes.
 *
 * @category Assets
 */
export function parseGltf(doc: GltfDoc, buffers: ArrayBuffer[]): Node3D {
  const root = new Node3D('gltf-root')
  const sceneIndex = doc.scene ?? 0
  const sceneNodes = doc.scenes?.[sceneIndex]?.nodes ?? []
  for (const nodeIndex of sceneNodes) root.add(buildNode(doc, buffers, nodeIndex))
  return root
}

function decodeDataUri(uri: string): ArrayBuffer {
  const comma = uri.indexOf(',')
  const meta = uri.slice(5, comma)
  const data = uri.slice(comma + 1)
  if (meta.includes('base64')) {
    const bin = atob(data)
    const bytes = new Uint8Array(bin.length)
    for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i)
    return bytes.buffer
  }
  return new TextEncoder().encode(decodeURIComponent(data)).buffer
}

const GLB_MAGIC = 0x46546c67
const GLB_JSON = 0x4e4f534a
const GLB_BIN = 0x004e4942

function parseGlb(data: ArrayBuffer): { doc: GltfDoc; buffers: ArrayBuffer[] } {
  const dv = new DataView(data)
  if (dv.getUint32(0, true) !== GLB_MAGIC) throw new Error('loadGltf: not a .glb (bad magic)')
  const total = dv.getUint32(8, true)
  let offset = 12
  let doc: GltfDoc | null = null
  let bin: ArrayBuffer | null = null
  while (offset < total) {
    const chunkLen = dv.getUint32(offset, true)
    const chunkType = dv.getUint32(offset + 4, true)
    const chunkStart = offset + 8
    if (chunkType === GLB_JSON) {
      const text = new TextDecoder().decode(new Uint8Array(data, chunkStart, chunkLen))
      doc = JSON.parse(text) as GltfDoc
    } else if (chunkType === GLB_BIN) {
      bin = data.slice(chunkStart, chunkStart + chunkLen)
    }
    offset = chunkStart + chunkLen
  }
  if (!doc) throw new Error('loadGltf: .glb missing JSON chunk')
  return { doc, buffers: bin ? [bin] : [] }
}

async function resolveBuffers(doc: GltfDoc, baseUrl: string): Promise<ArrayBuffer[]> {
  const out: ArrayBuffer[] = []
  for (const buf of doc.buffers ?? []) {
    if (!buf.uri) {
      out.push(new ArrayBuffer(0)) // GLB BIN buffer, filled by parseGlb path
    } else if (buf.uri.startsWith('data:')) {
      out.push(decodeDataUri(buf.uri))
    } else {
      const url = new URL(buf.uri, baseUrl).href
      out.push(await (await fetch(url)).arrayBuffer())
    }
  }
  return out
}

/**
 * Fetch and parse a glTF 2.0 model, returning its scene root {@link Node3D}. Add
 * the result under {@link World3D.root}. Supports `.glb` and `.gltf` (external or
 * data-URI buffers).
 *
 * @category Assets
 */
export async function loadGltf(url: string): Promise<Node3D> {
  const res = await fetch(url)
  if (url.endsWith('.glb') || res.headers.get('content-type')?.includes('gltf-binary')) {
    const { doc, buffers } = parseGlb(await res.arrayBuffer())
    return parseGltf(doc, buffers)
  }
  const doc = (await res.json()) as GltfDoc
  const buffers = await resolveBuffers(doc, url)
  return parseGltf(doc, buffers)
}
