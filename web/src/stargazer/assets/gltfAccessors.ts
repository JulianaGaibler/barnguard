// glTF accessor + buffer-view decoding: the pure layer that turns typed binary
// accessors into `Float32Array` / index arrays, honoring componentType,
// `normalized` dequantization, and interleave stride. No scene or material
// knowledge, so it is unit-testable in isolation and shared by the geometry and
// animation builders in `gltf.ts`.

export interface GltfAccessor {
  bufferView?: number
  byteOffset?: number
  componentType: number
  normalized?: boolean
  count: number
  type: 'SCALAR' | 'VEC2' | 'VEC3' | 'VEC4' | string
}

export interface GltfBufferView {
  buffer: number
  byteOffset?: number
  byteLength: number
  byteStride?: number
}

/**
 * The slice of a glTF document these decoders read. `GltfDoc` satisfies it
 * structurally, so callers pass the whole document.
 */
export interface AccessorSource {
  accessors?: GltfAccessor[]
  bufferViews?: GltfBufferView[]
}

export const COMPONENT = {
  BYTE: 5120,
  UNSIGNED_BYTE: 5121,
  SHORT: 5122,
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
/** Byte size of one component for each glTF componentType. */
const COMPONENT_BYTES: Record<number, number> = {
  [COMPONENT.BYTE]: 1,
  [COMPONENT.UNSIGNED_BYTE]: 1,
  [COMPONENT.SHORT]: 2,
  [COMPONENT.UNSIGNED_SHORT]: 2,
  [COMPONENT.UNSIGNED_INT]: 4,
  [COMPONENT.FLOAT]: 4,
}

/**
 * Read one component at `byteOffset`, converting integer componentTypes to
 * float and applying glTF `normalized` dequantization (`/255`, `/65535`, or the
 * signed `max(v/MAX, -1)`). Both target assets store all attributes as `FLOAT`,
 * so this is a correctness guard for quantized models rather than a hot path.
 */
function readComponent(
  dv: DataView,
  byteOffset: number,
  componentType: number,
  normalized: boolean,
): number {
  switch (componentType) {
    case COMPONENT.FLOAT:
      return dv.getFloat32(byteOffset, true)
    case COMPONENT.UNSIGNED_BYTE: {
      const v = dv.getUint8(byteOffset)
      return normalized ? v / 255 : v
    }
    case COMPONENT.BYTE: {
      const v = dv.getInt8(byteOffset)
      return normalized ? Math.max(v / 127, -1) : v
    }
    case COMPONENT.UNSIGNED_SHORT: {
      const v = dv.getUint16(byteOffset, true)
      return normalized ? v / 65535 : v
    }
    case COMPONENT.SHORT: {
      const v = dv.getInt16(byteOffset, true)
      return normalized ? Math.max(v / 32767, -1) : v
    }
    case COMPONENT.UNSIGNED_INT:
      return dv.getUint32(byteOffset, true)
    default:
      return dv.getFloat32(byteOffset, true)
  }
}

/**
 * Read an accessor into floats, honoring componentType, `normalized`, and the
 * buffer view's optional interleave stride.
 */
export function readFloats(
  doc: AccessorSource,
  buffers: ArrayBuffer[],
  accessorIndex: number,
): Float32Array {
  const acc = doc.accessors![accessorIndex]
  const comps = COMPONENTS_PER_TYPE[acc.type] ?? 1
  const out = new Float32Array(acc.count * comps)
  if (acc.bufferView === undefined) return out // sparse-only accessor: zeros
  const view = doc.bufferViews![acc.bufferView]
  const buffer = buffers[view.buffer]
  const base = (view.byteOffset ?? 0) + (acc.byteOffset ?? 0)
  const compBytes = COMPONENT_BYTES[acc.componentType] ?? 4
  const stride = view.byteStride ?? comps * compBytes
  const normalized = acc.normalized ?? false
  const dv = new DataView(buffer)
  for (let i = 0; i < acc.count; i++) {
    const elem = base + i * stride
    for (let c = 0; c < comps; c++) {
      out[i * comps + c] = readComponent(
        dv,
        elem + c * compBytes,
        acc.componentType,
        normalized,
      )
    }
  }
  return out
}

/**
 * Read an index accessor into the narrowest typed array that fits the component
 * type.
 */
export function readIndices(
  doc: AccessorSource,
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
    if (acc.componentType === COMPONENT.UNSIGNED_INT)
      out[i] = dv.getUint32(base + i * 4, true)
    else if (acc.componentType === COMPONENT.UNSIGNED_SHORT)
      out[i] = dv.getUint16(base + i * 2, true)
    else out[i] = dv.getUint8(base + i) // UNSIGNED_BYTE
  }
  return out
}

/**
 * Smooth per-vertex normals from positions + indices, for meshes lacking
 * NORMAL.
 */
export function computeNormals(
  positions: Float32Array,
  indices: Uint16Array | Uint32Array,
): Float32Array {
  const normals = new Float32Array(positions.length)
  for (let t = 0; t < indices.length; t += 3) {
    const ia = indices[t] * 3
    const ib = indices[t + 1] * 3
    const ic = indices[t + 2] * 3
    const ax = positions[ia],
      ay = positions[ia + 1],
      az = positions[ia + 2]
    const bx = positions[ib],
      by = positions[ib + 1],
      bz = positions[ib + 2]
    const cx = positions[ic],
      cy = positions[ic + 1],
      cz = positions[ic + 2]
    const e1x = bx - ax,
      e1y = by - ay,
      e1z = bz - az
    const e2x = cx - ax,
      e2y = cy - ay,
      e2z = cz - az
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

/** Identity index buffer `[0, 1, 2, …]` for a non-indexed primitive. */
export function sequentialIndices(
  vertexCount: number,
): Uint16Array | Uint32Array {
  const out =
    vertexCount > 65535
      ? new Uint32Array(vertexCount)
      : new Uint16Array(vertexCount)
  for (let i = 0; i < vertexCount; i++) out[i] = i
  return out
}
