import { Node3D } from '../scene/Node3D'
import {
  MeshNode,
  type MeshGeometry,
  type MeshMaterial,
  type MaterialTexture,
  type TextureImage,
  type TextureSampler,
} from '../nodes/MeshNode'
import {
  type Light3D,
  DirectionalLight3D,
  PointLight3D,
  SpotLight3D,
} from '../nodes/Light3D'
import { AnimationPlayer } from '../anim/AnimationPlayer'
import type {
  AnimationClip,
  AnimationChannel,
  ChannelPath,
  Interpolation,
} from '../anim/AnimationClip'
import { walkTree } from '../scene/traverse'
import {
  readFloats,
  readIndices,
  computeNormals,
  sequentialIndices,
  type GltfAccessor,
  type GltfBufferView,
} from './gltfAccessors'

/**
 * Loads glTF 2.0 models into a {@link Node3D} hierarchy for the 3D pass.
 *
 * `loadGltf(url)` fetches a `.gltf` (JSON, with external or data-URI buffers)
 * or a `.glb` (binary container), builds the tree, and decodes the material
 * images asynchronously. `parseGltf(json, buffers)` is the pure, synchronous
 * core: it builds the tree and attaches material texture descriptors (with the
 * images' _compressed_ bytes) but does no image decode or GPU work, so it's
 * used by tests and custom loaders; `loadGltf` wraps it with the
 * `createImageBitmap` decode pass.
 *
 * Scope: mesh geometry (POSITION, NORMAL, TEXCOORD_0, TANGENT, `TRIANGLES`,
 * 16-/32-bit indices, quantized attributes dequantized), the node hierarchy
 * with TRS or matrix transforms, and metallic-roughness materials with
 * base-color / metallic-roughness / normal / occlusion / emissive textures,
 * alpha mode, double-sidedness, and `KHR_materials_diffuse_transmission`.
 * Missing normals are computed (smooth). `KHR_materials_transmission` glass
 * degrades to a translucent blend (no refraction); skinning, morph targets,
 * animations, and IBL are not read here. The world is y-up right-handed,
 * matching glTF, so no axis conversion happens.
 *
 * @category Assets
 * @example
 *   const model = await loadGltf('/models/robot.glb')
 *   engine.tree.add(model)
 */

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
  extensions?: Record<string, unknown>
}

/** A `KHR_lights_punctual` light definition (document-level `lights[]` entry). */
interface GltfPunctualLight {
  type: 'directional' | 'point' | 'spot'
  color?: [number, number, number]
  intensity?: number
  /** Falloff cutoff (point/spot); absent = infinite. */
  range?: number
  spot?: { innerConeAngle?: number; outerConeAngle?: number }
}

/** A `{ index, texCoord? }` texture reference on a material channel. */
interface GltfTextureInfo {
  index: number
  texCoord?: number
  /** Present on normalTexture (`scale`) / occlusionTexture (`strength`). */
  scale?: number
  strength?: number
}

interface GltfMaterial {
  name?: string
  pbrMetallicRoughness?: {
    baseColorFactor?: [number, number, number, number]
    baseColorTexture?: GltfTextureInfo
    metallicFactor?: number
    roughnessFactor?: number
    metallicRoughnessTexture?: GltfTextureInfo
  }
  normalTexture?: GltfTextureInfo
  occlusionTexture?: GltfTextureInfo
  emissiveTexture?: GltfTextureInfo
  emissiveFactor?: [number, number, number]
  alphaMode?: 'OPAQUE' | 'MASK' | 'BLEND'
  alphaCutoff?: number
  doubleSided?: boolean
  extensions?: Record<string, unknown>
}

interface GltfSampler {
  magFilter?: number
  minFilter?: number
  wrapS?: number
  wrapT?: number
}

interface GltfTexture {
  source?: number
  sampler?: number
}

interface GltfImageDef {
  uri?: string
  mimeType?: string
  bufferView?: number
  name?: string
}

interface GltfAnimationSampler {
  input: number
  output: number
  interpolation?: string
}

interface GltfAnimationChannel {
  sampler: number
  target: { node?: number; path: string }
}

interface GltfAnimation {
  name?: string
  samplers: GltfAnimationSampler[]
  channels: GltfAnimationChannel[]
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
  textures?: GltfTexture[]
  samplers?: GltfSampler[]
  images?: GltfImageDef[]
  animations?: GltfAnimation[]
  extensionsUsed?: string[]
  extensionsRequired?: string[]
  extensions?: Record<string, unknown>
}

/**
 * Per-load state threaded through the builders: the document, its resolved
 * binary buffers, and a lazily-populated array of one {@link TextureImage} per
 * glTF `images[]` entry so materials sharing an image share the instance (the
 * renderer dedupes GPU textures by that identity).
 */
interface GltfContext {
  doc: GltfDoc
  buffers: ArrayBuffer[]
  images: (TextureImage | null)[]
  /** Built node per glTF node index, so animation channels can bind targets. */
  nodeByIndex: (Node3D | null)[]
  warned: Set<string>
}

/** GlTF sampler filter enums whose min-filter implies a mip chain. */
const MIPMAP_MIN_FILTERS = new Set([9984, 9985, 9986, 9987])
const WRAP_CLAMP = 33071 // CLAMP_TO_EDGE (default REPEAT = 10497)

/** Material extensions we knowingly handle or degrade; others just warn. */
const SUPPORTED_EXTENSIONS = new Set([
  'KHR_materials_diffuse_transmission',
  'KHR_materials_transmission', // degraded to a translucent blend (no refraction)
  'KHR_materials_clearcoat', // ignored (no second specular lobe yet)
  'KHR_lights_punctual',
  'KHR_materials_emissive_strength',
])

/** Lazily build (and cache) the shared {@link TextureImage} for a glTF image. */
function resolveImage(
  ctx: GltfContext,
  imageIndex: number,
): TextureImage | null {
  const cached = ctx.images[imageIndex]
  if (cached) return cached
  const def = ctx.doc.images?.[imageIndex]
  if (!def) return null
  let bytes: Uint8Array | null = null
  let uri: string | undefined
  const mimeType = def.mimeType ?? 'image/png'
  if (def.bufferView !== undefined) {
    const view = ctx.doc.bufferViews![def.bufferView]
    const buffer = ctx.buffers[view.buffer]
    bytes = new Uint8Array(buffer, view.byteOffset ?? 0, view.byteLength)
  } else if (def.uri?.startsWith('data:')) {
    bytes = new Uint8Array(decodeDataUri(def.uri))
  } else if (def.uri) {
    uri = def.uri // external file, fetched by the async loader
  } else {
    return null
  }
  const image: TextureImage = { bytes, uri, mimeType, bitmap: null }
  ctx.images[imageIndex] = image
  return image
}

/** Resolve a glTF sampler to wrap mode + whether to sample a mip chain. */
function resolveSampler(
  doc: GltfDoc,
  samplerIndex: number | undefined,
): TextureSampler {
  const s =
    samplerIndex !== undefined ? doc.samplers?.[samplerIndex] : undefined
  const wrap: 'clamp' | 'repeat' =
    s?.wrapS === WRAP_CLAMP || s?.wrapT === WRAP_CLAMP ? 'clamp' : 'repeat'
  // Absent min-filter ⇒ trilinear (mips); an explicit non-mip filter ⇒ no mips.
  const mipmap =
    s?.minFilter === undefined ? true : MIPMAP_MIN_FILTERS.has(s.minFilter)
  return { wrap, mipmap }
}

/** Resolve a material texture-info to a {@link MaterialTexture}, or null. */
function textureSlot(
  ctx: GltfContext,
  info: GltfTextureInfo | undefined,
  srgb: boolean,
  forceNoMips = false,
): MaterialTexture | null {
  if (!info) return null
  const tex = ctx.doc.textures?.[info.index]
  if (!tex || tex.source === undefined) return null
  const image = resolveImage(ctx, tex.source)
  if (!image) return null
  const sampler = resolveSampler(ctx.doc, tex.sampler)
  // Alpha-cutout albedo must not mip: the chain washes the 0.5 threshold and
  // erodes the cutout at distance.
  if (forceNoMips) sampler.mipmap = false
  return { image, sampler, srgb }
}

/** Warn once per unsupported glTF extension; never throw (still load, degraded). */
function warnUnsupportedExtensions(ctx: GltfContext): void {
  for (const ext of ctx.doc.extensionsUsed ?? []) {
    if (SUPPORTED_EXTENSIONS.has(ext) || ctx.warned.has(ext)) continue
    ctx.warned.add(ext)
    const required = ctx.doc.extensionsRequired?.includes(ext)
      ? ' (required)'
      : ''
    console.warn(
      `loadGltf: unsupported extension ${ext}${required}; loading without it.`,
    )
  }
}

/**
 * Map a glTF material to a {@link MeshMaterial}. glTF materials are
 * metallic-roughness PBR, so `pbr` is set; textures are sRGB for base-color and
 * emissive, linear otherwise (metallic-roughness/normal/occlusion). Occlusion
 * often aliases the metallic-roughness image (packed ORM) — both are linear and
 * share one {@link TextureImage}, so the renderer uploads it once.
 */
function materialFor(
  ctx: GltfContext,
  index: number | undefined,
): MeshMaterial {
  const gm = index !== undefined ? ctx.doc.materials?.[index] : undefined
  if (!gm) {
    // No material: a plain lit gray, matching the pre-PBR default (not `pbr`).
    return { lit: true, color: [0.8, 0.8, 0.8, 1] }
  }
  const mr = gm.pbrMetallicRoughness ?? {}
  const color: [number, number, number, number] = mr.baseColorFactor
    ? [...mr.baseColorFactor]
    : [1, 1, 1, 1]
  const alphaMode = gm.alphaMode ?? 'OPAQUE'
  const mat: MeshMaterial = {
    lit: true,
    pbr: true,
    color,
    baseColorTex: textureSlot(
      ctx,
      mr.baseColorTexture,
      true,
      alphaMode === 'MASK',
    ),
    metalRoughTex: textureSlot(ctx, mr.metallicRoughnessTexture, false),
    normalTex: textureSlot(ctx, gm.normalTexture, false),
    occlusionTex: textureSlot(ctx, gm.occlusionTexture, false),
    emissiveTex: textureSlot(ctx, gm.emissiveTexture, true),
    metallicFactor: mr.metallicFactor ?? 1,
    roughnessFactor: mr.roughnessFactor ?? 1,
    emissiveFactor: gm.emissiveFactor ? [...gm.emissiveFactor] : [0, 0, 0],
    occlusionStrength: gm.occlusionTexture?.strength ?? 1,
    normalScale: gm.normalTexture?.scale ?? 1,
    alphaMode,
    alphaCutoff: gm.alphaCutoff ?? 0.5,
    doubleSided: gm.doubleSided ?? false,
  }
  const ext = gm.extensions ?? {}
  const es = ext['KHR_materials_emissive_strength'] as
    { emissiveStrength?: number } | undefined
  if (es?.emissiveStrength !== undefined) {
    const s = es.emissiveStrength
    const e = mat.emissiveFactor!
    mat.emissiveFactor = [e[0] * s, e[1] * s, e[2] * s]
  }
  const dt = ext['KHR_materials_diffuse_transmission'] as
    | {
        diffuseTransmissionFactor?: number
        diffuseTransmissionColorTexture?: GltfTextureInfo
      }
    | undefined
  if (dt) {
    mat.diffuseTransmission = dt.diffuseTransmissionFactor ?? 0
    mat.diffuseTransmissionTex = textureSlot(
      ctx,
      dt.diffuseTransmissionColorTexture,
      true,
    )
  }
  // KHR_materials_transmission (glass): no screen-space refraction yet, so fake
  // a translucent blend — otherwise a default-white opaque glass renders as a
  // solid slab hiding what's behind it. TODO(glass): real refraction pass.
  const tr = ext['KHR_materials_transmission'] as
    { transmissionFactor?: number } | undefined
  const transmission = tr?.transmissionFactor ?? 0
  if (transmission > 0) {
    mat.alphaMode = 'BLEND'
    mat.color[3] = mat.color[3] * (1 - transmission) + 0.25 * transmission
  }
  return mat
}

function geometryFor(
  ctx: GltfContext,
  prim: GltfPrimitive,
): MeshGeometry | null {
  const { doc, buffers } = ctx
  const posIdx = prim.attributes.POSITION
  if (posIdx === undefined) return null
  const positions = readFloats(doc, buffers, posIdx)
  const indices =
    prim.indices !== undefined
      ? readIndices(doc, buffers, prim.indices)
      : sequentialIndices(positions.length / 3)
  const normals =
    prim.attributes.NORMAL !== undefined
      ? readFloats(doc, buffers, prim.attributes.NORMAL)
      : computeNormals(positions, indices)
  const geom: MeshGeometry = { positions, normals, indices }
  if (prim.attributes.TEXCOORD_0 !== undefined) {
    geom.uvs = readFloats(doc, buffers, prim.attributes.TEXCOORD_0)
  }
  if (prim.attributes.TANGENT !== undefined) {
    geom.tangents = readFloats(doc, buffers, prim.attributes.TANGENT)
  }
  if (
    prim.attributes.TEXCOORD_1 !== undefined &&
    !ctx.warned.has('texcoord1')
  ) {
    ctx.warned.add('texcoord1')
    console.warn(
      'loadGltf: TEXCOORD_1 present but only TEXCOORD_0 is read; secondary UV set ignored.',
    )
  }
  return geom
}

/** Instantiate a `KHR_lights_punctual` light by its document-level index. */
function lightFor(ctx: GltfContext, index: number): Light3D | null {
  const ext = ctx.doc.extensions?.['KHR_lights_punctual'] as
    { lights?: GltfPunctualLight[] } | undefined
  const def = ext?.lights?.[index]
  if (!def) return null
  const color = def.color
    ? ([...def.color] as [number, number, number])
    : undefined
  const intensity = def.intensity ?? 1
  if (def.type === 'point') {
    return new PointLight3D({ color, intensity, range: def.range ?? 0 })
  }
  if (def.type === 'spot') {
    return new SpotLight3D({
      color,
      intensity,
      range: def.range ?? 0,
      innerConeAngle: def.spot?.innerConeAngle ?? 0,
      outerConeAngle: def.spot?.outerConeAngle ?? Math.PI / 4,
    })
  }
  return new DirectionalLight3D({ color, intensity })
}

function buildNode(ctx: GltfContext, index: number): Node3D {
  const gnode = ctx.doc.nodes![index]
  const node = new Node3D(gnode.name ?? `gltf-node-${index}`)
  ctx.nodeByIndex[index] = node
  applyTransform(node, gnode)
  if (gnode.mesh !== undefined) {
    const mesh = ctx.doc.meshes![gnode.mesh]
    for (const prim of mesh.primitives) {
      if (prim.mode !== undefined && prim.mode !== 4) continue // TRIANGLES only
      const geom = geometryFor(ctx, prim)
      if (geom) node.add(new MeshNode(geom, materialFor(ctx, prim.material)))
    }
  }
  // A KHR_lights_punctual light rides at the node's origin, aimed down its −Z;
  // add it as a child so it inherits the node's world transform.
  const lightExt = gnode.extensions?.['KHR_lights_punctual'] as
    { light?: number } | undefined
  if (lightExt?.light !== undefined) {
    const light = lightFor(ctx, lightExt.light)
    if (light) node.add(light)
  }
  for (const child of gnode.children ?? []) node.add(buildNode(ctx, child))
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
  const tx = m[12],
    ty = m[13],
    tz = m[14]
  let sx = Math.hypot(m[0], m[1], m[2])
  const sy = Math.hypot(m[4], m[5], m[6])
  const sz = Math.hypot(m[8], m[9], m[10])
  const det =
    m[0] * (m[5] * m[10] - m[6] * m[9]) -
    m[4] * (m[1] * m[10] - m[2] * m[9]) +
    m[8] * (m[1] * m[6] - m[2] * m[5])
  if (det < 0) sx = -sx
  const r00 = m[0] / sx,
    r01 = m[4] / sy,
    r02 = m[8] / sz
  const r10 = m[1] / sx,
    r11 = m[5] / sy,
    r12 = m[9] / sz
  const r20 = m[2] / sx,
    r21 = m[6] / sy,
    r22 = m[10] / sz
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

/** GlTF interpolation string → the clip's {@link Interpolation}. */
function interpolationOf(s: string | undefined): Interpolation {
  if (s === 'STEP') return 'STEP'
  if (s === 'CUBICSPLINE') return 'CUBICSPLINE'
  return 'LINEAR'
}

/**
 * Build {@link AnimationClip}s from the document, binding each channel to its
 * already-built target {@link Node3D}. Channels targeting an unbuilt node or a
 * `weights`/pointer path are skipped.
 */
function buildAnimations(ctx: GltfContext): AnimationClip[] {
  const clips: AnimationClip[] = []
  const anims = ctx.doc.animations ?? []
  for (let ai = 0; ai < anims.length; ai++) {
    const anim = anims[ai]
    const channels: AnimationChannel[] = []
    let duration = 0
    for (const ch of anim.channels) {
      const path = ch.target.path
      if (path !== 'translation' && path !== 'rotation' && path !== 'scale')
        continue
      if (ch.target.node === undefined) continue
      const target = ctx.nodeByIndex[ch.target.node]
      const sampler = anim.samplers[ch.sampler]
      if (!target || !sampler) continue
      const input = readFloats(ctx.doc, ctx.buffers, sampler.input)
      const output = readFloats(ctx.doc, ctx.buffers, sampler.output)
      channels.push({
        target,
        path: path as ChannelPath,
        sampler: {
          input,
          output,
          interpolation: interpolationOf(sampler.interpolation),
        },
      })
      if (input.length > 0)
        duration = Math.max(duration, input[input.length - 1])
    }
    if (channels.length > 0)
      clips.push({ name: anim.name ?? `clip-${ai}`, channels, duration })
  }
  return clips
}

/**
 * Build the {@link Node3D} tree from an already-parsed glTF document and its
 * resolved binary buffers. Pure and synchronous. Returns a root node holding
 * the default scene's top-level nodes, plus an {@link AnimationPlayer} for the
 * first animation clip (auto-playing, looped) when the document has
 * animations.
 *
 * @category Assets
 */
export function parseGltf(doc: GltfDoc, buffers: ArrayBuffer[]): Node3D {
  const ctx: GltfContext = {
    doc,
    buffers,
    images: new Array<TextureImage | null>(doc.images?.length ?? 0).fill(null),
    nodeByIndex: new Array<Node3D | null>(doc.nodes?.length ?? 0).fill(null),
    warned: new Set(),
  }
  warnUnsupportedExtensions(ctx)
  const root = new Node3D('gltf-root')
  const sceneIndex = doc.scene ?? 0
  const sceneNodes = doc.scenes?.[sceneIndex]?.nodes ?? []
  for (const nodeIndex of sceneNodes) root.add(buildNode(ctx, nodeIndex))
  const clips = buildAnimations(ctx)
  if (clips.length > 0) root.add(new AnimationPlayer(clips[0]))
  return root
}

/** The material texture slots that carry a {@link MaterialTexture}. */
function materialTextures(
  m: MeshMaterial,
): (MaterialTexture | null | undefined)[] {
  return [
    m.baseColorTex,
    m.metalRoughTex,
    m.normalTex,
    m.occlusionTex,
    m.emissiveTex,
    m.diffuseTransmissionTex,
  ]
}

/** Collect the unique {@link TextureImage}s referenced anywhere under `root`. */
function collectImages(root: Node3D): TextureImage[] {
  const set = new Set<TextureImage>()
  walkTree(root, (n) => {
    if (n instanceof MeshNode) {
      for (const t of materialTextures(n.material)) if (t) set.add(t.image)
    }
  })
  return [...set]
}

/**
 * Decode every image's compressed bytes into an `ImageBitmap` (fetching
 * external URIs first). Straight (non-premultiplied) with no orientation or
 * color-management applied, so the renderer controls sRGB/premultiply at
 * upload.
 */
async function decodeImages(root: Node3D, baseUrl: string): Promise<void> {
  await Promise.all(
    collectImages(root).map(async (img) => {
      if (img.bitmap) return
      if (!img.bytes && img.uri) {
        const url = new URL(img.uri, baseUrl).href
        img.bytes = new Uint8Array(await (await fetch(url)).arrayBuffer())
      }
      if (!img.bytes) return
      // Cast: our bytes are always ArrayBuffer-backed (GLB slice / decoded
      // data-URI / fetched file), never a SharedArrayBuffer view.
      const blob = new Blob([img.bytes as BlobPart], { type: img.mimeType })
      img.bitmap = await createImageBitmap(blob, {
        premultiplyAlpha: 'none',
        imageOrientation: 'none',
        colorSpaceConversion: 'none',
      })
    }),
  )
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
  if (dv.getUint32(0, true) !== GLB_MAGIC)
    throw new Error('loadGltf: not a .glb (bad magic)')
  const total = dv.getUint32(8, true)
  let offset = 12
  let doc: GltfDoc | null = null
  let bin: ArrayBuffer | null = null
  while (offset < total) {
    const chunkLen = dv.getUint32(offset, true)
    const chunkType = dv.getUint32(offset + 4, true)
    const chunkStart = offset + 8
    if (chunkType === GLB_JSON) {
      const text = new TextDecoder().decode(
        new Uint8Array(data, chunkStart, chunkLen),
      )
      doc = JSON.parse(text) as GltfDoc
    } else if (chunkType === GLB_BIN) {
      bin = data.slice(chunkStart, chunkStart + chunkLen)
    }
    offset = chunkStart + chunkLen
  }
  if (!doc) throw new Error('loadGltf: .glb missing JSON chunk')
  return { doc, buffers: bin ? [bin] : [] }
}

async function resolveBuffers(
  doc: GltfDoc,
  baseUrl: string,
): Promise<ArrayBuffer[]> {
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
 * the result to the scene tree (`engine.tree.add(root)`). Supports `.glb` and
 * `.gltf` (external or data-URI buffers). Material images decode before it
 * resolves, so textures are ready on the first frame.
 *
 * @category Assets
 */
export async function loadGltf(url: string): Promise<Node3D> {
  const res = await fetch(url)
  let root: Node3D
  if (
    url.endsWith('.glb') ||
    res.headers.get('content-type')?.includes('gltf-binary')
  ) {
    const { doc, buffers } = parseGlb(await res.arrayBuffer())
    root = parseGltf(doc, buffers)
  } else {
    const doc = (await res.json()) as GltfDoc
    const buffers = await resolveBuffers(doc, url)
    root = parseGltf(doc, buffers)
  }
  await decodeImages(root, url)
  return root
}
